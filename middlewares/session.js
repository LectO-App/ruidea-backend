const crypto = require('crypto');
const { signToken, verifyToken, tokenVersionClaim } = require('../functions/tokens');
const Usuario = require('../models/modeloUsuario');
const { isValidObjectId } = require('../db/objectId');

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
// A user session also carries the account's tokenVersion (`tv`, see isRevoked below).
const issueSession = (res, principal) => {
	const csrf = crypto.randomBytes(32).toString('hex');
	const claims = { id: principal.id || null, role: principal.role, csrf };
	if (principal.role === 'user') claims.tv = principal.tokenVersion || 0;
	const token = signToken(claims, { expiresIn: SESSION_TTL });

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

// A user session is valid only while the account's tokenVersion still equals the one it
// was issued with. Password reset, password change and logout increment it, which ends
// every session issued before, on every device. A session whose account no longer exists
// is refused too. Admin sessions have no account row and are not checked here.
const isRevoked = async payload => {
	if (payload.role === 'admin') return false;
	if (!isValidObjectId(payload.id)) return true;
	const current = await Usuario.tokenVersionOf(payload.id);
	return current === null || current !== tokenVersionClaim(payload);
};

const authenticate = async (req, res, requiredRole) => {
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
	if (await isRevoked(payload)) {
		res.status(401).json({ message: 'Sesión inválida o expirada.' });
		return null;
	}
	return payload;
};

// Express 4 doesn't catch rejected promises from middleware, so a failed lookup is
// answered here instead of leaving the request hanging.
const guard = requiredRole => async (req, res, next) => {
	let payload;
	try {
		payload = await authenticate(req, res, requiredRole);
	} catch (err) {
		req.log && req.log.error({ err }, 'session check failed');
		return res.status(500).json({ message: 'Error interno' });
	}
	if (!payload) return;
	req.user = payload;
	next();
};

const authUser = guard(null);
const authAdmin = guard('admin');

// Logout. With a valid user session and its CSRF header, the account's tokenVersion is
// incremented, so every session issued before (on any device, including copies of this
// cookie) stops working. Without them only the cookies are cleared, so another site can't
// log someone out everywhere.
const endSession = async (req, res) => {
	let payload = null;
	try {
		payload = verifyToken(req.cookies && req.cookies[SESSION_COOKIE]);
	} catch {
		// No session, or an invalid or expired one: nothing to revoke.
	}
	clearSession(res);
	if (!payload || payload.purpose || payload.role !== 'user' || !checkCsrf(req, payload)) return;
	if (await isRevoked(payload)) return;
	await Usuario.bumpTokenVersion(payload.id);
};

module.exports = {
	SESSION_COOKIE,
	CSRF_COOKIE,
	issueSession,
	clearSession,
	endSession,
	authUser,
	authAdmin,
};
