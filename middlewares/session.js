const crypto = require('crypto');
const { signToken, verifyToken } = require('../functions/tokens');

// Real server-side sessions replacing the public shared "authkey" and the client-set
// `admin=true` / `logged-in` cookies (SECURITY_ASSESSMENT.md §1.1–1.4). The identity
// lives in a signed, httpOnly JWT cookie the browser cannot read or forge.

const SESSION_COOKIE = 'token';
const CSRF_COOKIE = 'csrf-token';
const CSRF_HEADER = 'x-csrf-token';
const SESSION_TTL = '7d';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === 'production';

// Cross-site SPA -> API needs SameSite=None + Secure in production. In dev (http,
// localhost) fall back to Lax/non-secure so cookies are still set without https.
const baseCookie = () => ({
	secure: isProd,
	sameSite: isProd ? 'none' : 'lax',
	path: '/',
	maxAge: SESSION_MAX_AGE,
});

// Issues the session: an httpOnly auth cookie (not JS-readable). The CSRF token is
// embedded as a claim INSIDE the signed JWT and also returned in the response body.
// The frontend and API are on different domains, so a CSRF cookie set by the API would
// not be readable by the SPA — instead the SPA stores the returned token and echoes it
// in a header, and the server compares it to the (unforgeable) JWT claim. An attacker
// can ride the ambient cookie but cannot read the token or set the header (CORS).
const issueSession = (res, principal) => {
	const csrf = crypto.randomBytes(32).toString('hex');
	const token = signToken(
		{ id: principal.id || null, role: principal.role, csrf },
		{ expiresIn: SESSION_TTL }
	);

	res.cookie(SESSION_COOKIE, token, { ...baseCookie(), httpOnly: true });
	return csrf;
};

const clearSession = res => {
	const opts = { path: '/', secure: isProd, sameSite: isProd ? 'none' : 'lax' };
	res.clearCookie(SESSION_COOKIE, { ...opts, httpOnly: true });
	res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
};

const safeEqual = (a, b) => {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
	return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

// Any state-changing request must carry a header matching the CSRF token bound to the
// session JWT. A cross-origin attacker can ride the ambient cookie but (with the CORS
// allowlist) cannot learn the token or set the header.
const checkCsrf = (req, payload) => {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
	const headerToken = req.get(CSRF_HEADER);
	return Boolean(payload.csrf) && safeEqual(payload.csrf, headerToken || '');
};

const authenticate = (req, res, requiredRole) => {
	const token = req.cookies && req.cookies[SESSION_COOKIE];
	if (!token) {
		res.status(401).json({ message: 'No autenticado.' });
		return null;
	}
	let payload;
	try {
		payload = verifyToken(token);
	} catch (err) {
		res.status(401).json({ message: 'Sesión inválida o expirada.' });
		return null;
	}
	// Session tokens carry no `purpose`; reject email-verify/password-reset/render tokens
	// (signed with the same secret) from being replayed as a session.
	if (payload.purpose) {
		res.status(401).json({ message: 'Sesión inválida.' });
		return null;
	}
	if (requiredRole && payload.role !== requiredRole) {
		res.status(403).json({ message: 'No autorizado.' });
		return null;
	}
	if (!checkCsrf(req, payload)) {
		res.status(403).json({ message: 'Token CSRF inválido.' });
		return null;
	}
	return payload;
};

const authUser = (req, res, next) => {
	const payload = authenticate(req, res, null);
	if (!payload) return;
	req.user = payload;
	next();
};

const authAdmin = (req, res, next) => {
	const payload = authenticate(req, res, 'admin');
	if (!payload) return;
	req.user = payload;
	next();
};

module.exports = {
	SESSION_COOKIE,
	CSRF_COOKIE,
	issueSession,
	clearSession,
	authUser,
	authAdmin,
};
