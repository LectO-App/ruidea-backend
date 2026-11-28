const crypto = require('crypto');
const { signToken } = require('./tokens');

// The verification link and the 6-digit code are both bound to the account id and to the
// address they were sent to, so after an address change nothing sent to the old address
// confirms the new one. The code is stateless: an HMAC over the id, the address and the
// hour it was issued in, accepted for 24 hours. No column stores it.

const JWT_SECRET = process.env.JWT_SECRET;
const HOUR = 60 * 60 * 1000;
const VALID_HOURS = 24;
const MAX_WRONG_TRIES = 5;

const normalize = address => String(address || '').trim().toLowerCase();

// Short hash of the address for the link token (claim `eh`): binds the token without
// putting the address in it.
const emailHash = address =>
	crypto.createHmac('sha256', JWT_SECRET).update(`email-hash:${normalize(address)}`).digest('base64url').slice(0, 22);

const signEmailVerifyToken = (id, address) => signToken({ id: String(id), purpose: 'email-verify', eh: emailHash(address) }, { expiresIn: '24h' });

const tokenMatchesAddress = (payload, address) => typeof payload.eh === 'string' && payload.eh === emailHash(address);

const hourOf = now => Math.floor(now / HOUR);

const codeFor = (id, address, hour) => {
	const digest = crypto.createHmac('sha256', JWT_SECRET).update(`email-code:${id}:${normalize(address)}:${hour}`).digest();
	return String(digest.readUInt32BE(0) % 1000000).padStart(6, '0');
};

const emailCode = (id, address, now = Date.now()) => codeFor(String(id), address, hourOf(now));

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const codeMatches = (id, address, code, now = Date.now()) => {
	const current = hourOf(now);
	let match = false;
	for (let h = current - (VALID_HOURS - 1); h <= current; h++) {
		if (safeEqual(codeFor(String(id), address, h), code)) match = true;
	}
	return match;
};

// Wrong tries per account, counted per hour (the window a code is issued in). In memory:
// each server instance counts on its own, and a restart clears the count.
const wrongTries = new Map();

const triesLeft = (id, now = Date.now()) => {
	const entry = wrongTries.get(String(id));
	if (!entry || entry.hour !== hourOf(now)) return MAX_WRONG_TRIES;
	return Math.max(0, MAX_WRONG_TRIES - entry.count);
};

const recordWrongTry = (id, now = Date.now()) => {
	const key = String(id);
	const hour = hourOf(now);
	const entry = wrongTries.get(key);
	if (!entry || entry.hour !== hour) wrongTries.set(key, { hour, count: 1 });
	else entry.count += 1;
	for (const [k, v] of wrongTries) if (v.hour !== hour) wrongTries.delete(k);
};

const clearWrongTries = id => wrongTries.delete(String(id));

module.exports = {
	MAX_WRONG_TRIES,
	emailHash,
	signEmailVerifyToken,
	tokenMatchesAddress,
	emailCode,
	codeMatches,
	triesLeft,
	recordWrongTry,
	clearWrongTries,
};
