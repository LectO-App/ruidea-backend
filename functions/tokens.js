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

const verifyToken = token => jwt.verify(token, JWT_SECRET);

module.exports = { signToken, verifyToken };
