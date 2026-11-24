const crypto = require('crypto');
const Usuario = require('../models/modeloUsuario');
const { signToken, verifyToken, tokenVersionClaim } = require('./tokens');

// Sign-in by emailed link. The link's token is signed with its own purpose, lasts 15 minutes
// and carries a random nonce; the account stores only the nonce's SHA-256 and expiry
// (models/modeloUsuario.js), so the link works once without touching tokenVersion.
const PURPOSE = 'magic-login';
const TTL_MS = 15 * 60 * 1000;

const hashNonce = nonce => crypto.createHash('sha256').update(nonce).digest('hex');

// A new link for this account; it replaces the previous one. `next` is the path to open
// after signing in (validated by the route's schema).
const createMagicLinkToken = async (user, next) => {
	const nonce = crypto.randomBytes(32).toString('base64url');
	await Usuario.setMagicLink(user._id, hashNonce(nonce), new Date(Date.now() + TTL_MS));
	const claims = { id: String(user._id), purpose: PURPOSE, tv: user.tokenVersion, n: nonce };
	if (next) claims.next = next;
	return signToken(claims, { expiresIn: TTL_MS / 1000 });
};

// The account the token signs in, after spending the link; null for an expired, used,
// replaced, wrong-purpose or revoked (tokenVersion changed) token.
const useMagicLinkToken = async token => {
	let payload;
	try {
		payload = verifyToken(token);
	} catch {
		return null;
	}
	if (payload.purpose !== PURPOSE || typeof payload.n !== 'string') return null;
	const user = await Usuario.findById(payload.id);
	if (!user || tokenVersionClaim(payload) !== user.tokenVersion) return null;
	if (!(await Usuario.consumeMagicLink(user._id, hashNonce(payload.n)))) return null;
	return { user, next: payload.next };
};

module.exports = { createMagicLinkToken, useMagicLinkToken };
