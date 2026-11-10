const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const Usuario = require('../models/modeloUsuario');

// Guards against CastError crashes: a non-ObjectId id (e.g. the admin session's "admin")
// must yield a clean 4xx, never an unhandled rejection that takes down the process.
const { isValidObjectId: isValidId } = require('../db/objectId');
const { verifyToken, tokenVersionClaim } = require('../functions/tokens');
const { issueSession, endSession, authUser, authAdmin } = require('../middlewares/session');
const { emailLimiter, authLimiter, verifyLimiter } = require('../middlewares/rate-limit');
const { validate } = require('../middlewares/validate');
const schemas = require('../validation/schemas');
const { resolveVerifier, verifierKeyQuota } = require('../functions/verifier');
const { writeAudit } = require('../functions/audit');
const { getPassport } = require('../functions/passportRender');
const { deleteUserDocuments, logBlobError } = require('../functions/blob');

const { sendPasswordResetEmail } = require('../functions/sendEmail');

const safeEqual = (a, b) => {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	const ha = crypto.createHash('sha256').update(a).digest();
	const hb = crypto.createHash('sha256').update(b).digest();
	return crypto.timingSafeEqual(ha, hb);
};

// Document numbers match ignoring case, spaces, dots and dashes: a verifier who types
// "40111222" or "12345678z" from an ID card matches "40.111.222" / "12345678Z" as stored.
const docKey = v => String(v == null ? '' : v).toUpperCase().replace(/[\s.-]/g, '');
const sameDocumento = (stored, given) => {
	const key = docKey(stored);
	return key.length > 0 && key === docKey(given);
};

// Minimal public projection for a share link — never the whole document (§1.6, §2.2).
const publicView = u => ({
	nombre: u.nombre,
	apellidos: u.apellidos,
	paisResidencia: u.paisResidencia,
	numeroDocumento: u.numeroDocumento,
	numeroPasaporte: u.numeroPasaporte,
	fechaNacimiento: u.fechaNacimiento,
	diagnostico: u.diagnostico,
	estado: u.estado,
});

// Old number-based links (/verificar/<documento>/<numeroPasaporte>) are printed in the QR of
// every passport downloaded before share tokens existed, and in links holders already copied.
// They keep working while LEGACY_NUMBER_LINKS is on (the default); set it to 0/false/off/no
// to retire them. Read per request, so tests and a restart pick up a change.
const legacyNumberLinks = () => !/^(0|false|off|no)$/i.test(String(process.env.LEGACY_NUMBER_LINKS || '').trim());

const verifyAnswer = (req, res, usuario, ok, audit) => {
	writeAudit(req, { ...audit, outcome: ok ? 'success' : audit.outcome || 'not_found' });
	if (!ok) return res.json({ existe: false });
	res.json({ existe: true, usuario: publicView(usuario) });
};

// Public passport page by share token: the random token in the passport's QR code and in the
// holder's "Copiar enlace" link. Only an accepted passport resolves; returns the same minimal
// fields as the number-based link; rate-limited + audited. The audit records the passport
// number on success and never the token.
router.post('/verificar/:token', verifyLimiter, async (req, res) => {
	const usuario = Usuario.isShareToken(req.params.token)
		? await Usuario.findByShareToken(req.params.token, 'aceptado')
		: null;
	verifyAnswer(req, res, usuario, Boolean(usuario), {
		action: 'passport.verify_token',
		target: usuario ? String(usuario.numeroPasaporte) : undefined,
	});
});

// Legacy public passport share link (see legacyNumberLinks). Requires both the document and
// passport number; only an accepted passport resolves; returns minimal fields; rate-limited +
// audited (§1.6). With LEGACY_NUMBER_LINKS off it answers like an unknown passport.
router.post('/verificar/:numeroDocumento/:numeroPasaporte', verifyLimiter, async (req, res) => {
	const numeroPasaporte = Number(req.params.numeroPasaporte);
	if (!legacyNumberLinks()) {
		writeAudit(req, { action: 'passport.verify_link', target: String(req.params.numeroPasaporte).slice(0, 16), outcome: 'legacy_disabled' });
		return res.json({ existe: false });
	}
	if (!Number.isFinite(numeroPasaporte)) return res.json({ existe: false });

	const usuario = await Usuario.findByPassportNumber(numeroPasaporte, 'aceptado');
	const ok = usuario && sameDocumento(usuario.numeroDocumento, req.params.numeroDocumento);
	verifyAnswer(req, res, usuario, ok, { action: 'passport.verify_link', target: String(numeroPasaporte) });
});

// Who is asking: a per-verifier API key (X-Verifier-Key, preferred) or the legacy shared
// password (constant-time). Sets req.verifier for a key, so verifierKeyQuota can count it.
const verifierCredential = async (req, res, next) => {
	if (!docKey(req.body.documento)) {
		return res.status(400).json({ correcto: false, message: 'Indica el número de documento del titular.' });
	}
	try {
		req.verifier = await resolveVerifier(req);
	} catch (err) {
		req.log && req.log.error({ err }, 'verificarCheckPassword failed');
		return res.status(401).json({ correcto: false });
	}
	const { password } = req.body;
	const sharedOk = password && process.env.VERIFY_PASSWORD && safeEqual(password, process.env.VERIFY_PASSWORD);
	if (!req.verifier && !sharedOk) {
		writeAudit(req, { action: 'passport.lookup', outcome: 'denied', actorType: 'verifier' });
		return res.status(401).json({ correcto: false });
	}
	next();
};

// Verifier check: does this passport number belong to this document number on an accepted
// passport? The caller presents both (from the card or its QR) and gets only yes/no plus,
// on yes, the passport's share token (to open its public page); the answer never carries the
// document number or any other field, so a credential cannot turn passport numbers (issued
// in sequence) into document numbers. Wrong credential, unknown
// passport and wrong document all get the same 401; every attempt is audited (§1.8, §10.4,
// §11.1). Per-verifier keys also have an hourly quota (functions/verifier.js).
router.post(
	'/verificarCheckPassword',
	verifyLimiter,
	validate(schemas.verifyCheckSchema),
	verifierCredential,
	verifierKeyQuota,
	async (req, res) => {
		const { pasaporte, documento } = req.body;
		const { verifier } = req;
		try {
			const usuario = await Usuario.findByPassportNumber(pasaporte, 'aceptado');
			const ok = usuario && sameDocumento(usuario.numeroDocumento, documento);
			writeAudit(req, {
				action: 'passport.lookup',
				actorType: verifier ? 'verifier' : 'anonymous',
				actorId: verifier ? verifier.id : 'shared',
				target: String(pasaporte),
				outcome: ok ? 'success' : usuario ? 'document_mismatch' : 'not_found',
			});

			if (!ok) return res.status(401).json({ correcto: false });
			// The share token of the passport just confirmed, so the verifier page opens
			// /verificar/<token> (it works whether or not LEGACY_NUMBER_LINKS is on). The caller
			// already holds the passport and document numbers and a credential; the token opens
			// the same public page those numbers open while the legacy links are on.
			res.json({ correcto: true, existe: true, token: usuario.shareToken });
		} catch (err) {
			req.log && req.log.error({ err }, 'verificarCheckPassword failed');
			res.status(401).json({ correcto: false });
		}
	}
);

// Current user's own record (replaces IDOR-prone /estado/:id fetched from a cookie id, §1.5).
// An admin session (id "admin") is not a regular user, so this returns 404 for it.
router.get('/me', authUser, async (req, res) => {
	if (!isValidId(req.user.id)) return res.status(404).json({ message: 'Usuario no encontrado' });
	const usuario = await Usuario.findById(req.user.id);
	if (!usuario) return res.status(404).json({ message: 'Usuario no encontrado' });
	// Include the session CSRF token so the SPA can recover it after a page reload.
	// shareToken: the holder's own public passport link (/verificar/<shareToken>).
	res.json({ ...usuario.toJSON(), shareToken: usuario.shareToken, csrfToken: req.user.csrf });
});

// Kept for compatibility, but now ownership-or-admin enforced.
router.get('/estado/:id', authUser, async (req, res) => {
	if (req.user.role !== 'admin' && req.user.id !== req.params.id)
		return res.status(403).json({ message: 'No autorizado' });
	if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Usuario no encontrado' });
	const usuario = await Usuario.findById(req.params.id);
	if (!usuario) return res.status(404).json({ message: 'Usuario no encontrado' });
	res.json(usuario);
});

router.post('/login', authLimiter, validate(schemas.loginSchema), async (req, res) => {
	try {
		const { user, password } = req.body;
		const usuario = !isNaN(user) ? await Usuario.findByPassportNumber(Number(user)) : await Usuario.findByEmail(user);
		if (usuario == null) return res.status(401).json({ correcto: false });

		const match = await bcrypt.compare(password, usuario.password);
		if (!match) {
			writeAudit(req, { action: 'user.login', target: String(usuario._id), outcome: 'denied' });
			return res.status(401).json({ correcto: false });
		}

		const csrf = issueSession(res, { id: String(usuario._id), role: 'user', tokenVersion: usuario.tokenVersion });
		writeAudit(req, { action: 'user.login', actorType: 'user', actorId: String(usuario._id), outcome: 'success' });
		res.json({ correcto: true, usuario, csrfToken: csrf });
	} catch (err) {
		req.log && req.log.error({ err }, 'login failed');
		res.status(401).json({ correcto: false });
	}
});

// Ends every session of the account, not only this cookie (middlewares/session.js).
router.post('/logout', async (req, res) => {
	try {
		await endSession(req, res);
		res.json({ ok: true });
	} catch (err) {
		req.log && req.log.error({ err }, 'logout failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

router.get('/count', authAdmin, async (req, res) => {
	const cant = await Usuario.count();
	res.json({ cant });
});

router.get('/descargar/:type/:id', authUser, async (req, res) => {
	if (req.user.role !== 'admin' && req.user.id !== req.params.id)
		return res.status(403).json({ message: 'No autorizado' });

	const type = req.params.type === 'pdf' ? 'pdf' : req.params.type === 'img' ? 'img' : null;
	if (!type) return res.status(400).json({ message: 'Tipo inválido' });

	const user = await Usuario.findById(req.params.id).catch(() => null);
	if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
	if (user.estado !== 'aceptado') return res.status(409).json({ message: 'El pasaporte aún no fue emitido' });

	try {
		// Rendered HTML is fed directly to the headless page (setContent) — never served
		// over HTTP — and the result is cached until the user's data changes.
		const { buffer, cached } = await getPassport(user, type);
		writeAudit(req, { action: 'passport.download', actorType: req.user.role, actorId: req.user.id, target: String(user._id), meta: { type, cached } });
		res.set({ 'Content-Type': type === 'pdf' ? 'application/pdf' : 'image/jpeg', 'Content-Length': buffer.length });
		res.send(buffer);
	} catch (err) {
		req.log && req.log.error({ err }, 'descargar render failed');
		res.status(500).json({ message: 'No se pudo generar el documento' });
	}
});

router.post('/forgot-password', emailLimiter, validate(schemas.forgotPasswordSchema), async (req, res) => {
	// Same response whether or not the email exists — no enumeration oracle (§10.2).
	const generic = () => res.send('Si el correo está registrado, enviaremos un email de cambio de contraseña.');
	try {
		const user = await Usuario.findByEmail(req.body.email);
		if (user) await sendPasswordResetEmail(req.body.email, user._id, user.tokenVersion);
		writeAudit(req, { action: 'user.forgot_password', outcome: user ? 'success' : 'not_found' });
		generic();
	} catch (err) {
		req.log && req.log.error({ err }, 'forgot-password failed');
		generic();
	}
});

router.post('/change-password', authLimiter, validate(schemas.changePasswordSchema), async (req, res) => {
	try {
		const { token, password } = req.body;
		const payload = verifyToken(token);
		// Only a password-reset token may reset a password — not a verification/render/session
		// token signed with the same secret (§ token-purpose separation).
		if (payload.purpose !== 'password-reset') return res.status(400).json({ message: 'Token inválido.' });

		const user = await Usuario.findById(payload.id);
		if (!user) return res.status(400).json({ message: 'Token inválido.' });

		// Single use: the link carries the account's tokenVersion from when it was sent, and
		// setting the password increments it (atomically, so two concurrent uses can't both
		// pass). That also ends every existing session of the account.
		const linkVersion = tokenVersionClaim(payload);
		if (linkVersion !== user.tokenVersion) return res.status(400).json({ message: 'Token inválido.' });
		const changed = await Usuario.resetPassword(user, await bcrypt.hash(password, 10), linkVersion);
		if (!changed) return res.status(400).json({ message: 'Token inválido.' });
		writeAudit(req, { action: 'user.change_password', actorId: String(user._id), outcome: 'success' });
		res.json({ correcto: true });
	} catch (err) {
		req.log && req.log.error({ err }, 'change-password failed');
		res.status(400).json({ message: 'No se pudo cambiar la contraseña.' });
	}
});

// Deleting a user also removes their uploaded documents (§3.3). Admin only.
router.delete('/:id', authAdmin, async (req, res) => {
	if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Usuario no encontrado' });
	try {
		const user = await Usuario.deleteById(req.params.id);
		// Every upload of this person goes, not only the current zip.
		const docs = user ? await deleteUserDocuments(user._id, user.archivoBlob) : null;
		if (docs && docs.failed) logBlobError(req, docs.error, 'user documents not fully deleted', { failed: docs.failed });
		writeAudit(req, { action: 'user.delete', actorType: 'admin', actorId: req.user.id, target: req.params.id, outcome: user ? 'success' : 'not_found' });
		res.json({ message: 'Eliminado!', user });
	} catch (err) {
		req.log && req.log.error({ err }, 'delete user failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

module.exports = router;
