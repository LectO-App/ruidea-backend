const jwt = require('jsonwebtoken');

// The JWT signing secret MUST be different from SECURITY_KEY: SECURITY_KEY is the
// API "authkey" that the browser bundle ships publicly, so anything signed with it
// is forgeable by anyone (see SECURITY_ASSESSMENT.md §1.2). Tokens are signed and
// verified only on the server, so switching to a private secret needs no client change.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
	throw new Error(
		'JWT_SECRET is not set. Set a private signing secret (distinct from SECURITY_KEY) in the environment.'
	);
}

const signToken = (payload, options = { expiresIn: '12h' }) => jwt.sign(payload, JWT_SECRET, options);

// `options` is passed straight to jwt.verify — e.g. { ignoreExpiration: true } to recover
// the payload of an expired token (used by the email-verify resend flow).
const verifyToken = (token, options = {}) => jwt.verify(token, JWT_SECRET, options);

// The account tokenVersion a session or password-reset token was issued with (claim `tv`).
// Tokens issued before the claim existed don't carry it and count as version 0, the value
// every account starts with, so they keep working until the account's first password
// change or logout.
const tokenVersionClaim = payload => (Number.isInteger(payload && payload.tv) ? payload.tv : 0);

module.exports = { signToken, verifyToken, tokenVersionClaim };
