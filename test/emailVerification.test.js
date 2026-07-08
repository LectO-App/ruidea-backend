const { test } = require('node:test');
const assert = require('node:assert');

// tokens.js reads JWT_SECRET at require time — set it before importing.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const jwt = require('jsonwebtoken');
const { signToken, verifyToken } = require('../functions/tokens');

// The self-serve resend (/emailVerification/resend/:token) must recover the user id from
// an ALREADY-EXPIRED email-verify token — that's the whole point of the flow.
test('verifyToken with ignoreExpiration recovers an expired email-verify payload', () => {
	const token = signToken({ id: 'abc123', purpose: 'email-verify' }, { expiresIn: -10 });
	// Without the flag, an expired token is rejected.
	assert.throws(() => verifyToken(token), /expired/i);
	// With the flag, the payload comes back intact so we can look up the user.
	const payload = verifyToken(token, { ignoreExpiration: true });
	assert.equal(payload.id, 'abc123');
	assert.equal(payload.purpose, 'email-verify');
});

test('verifyToken rejects a token signed with a different secret even when ignoring expiry', () => {
	const forged = jwt.sign({ id: 'abc123', purpose: 'email-verify' }, 'not-the-real-secret');
	assert.throws(() => verifyToken(forged, { ignoreExpiration: true }), /signature/i);
});
