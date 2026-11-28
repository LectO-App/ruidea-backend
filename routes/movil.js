const express = require('express');
const router = express.Router();

const { authUser } = require('../middlewares/session');
const { phoneLimiter, phoneCodeLimiter } = require('../middlewares/rate-limit');
const { validate } = require('../middlewares/validate');
const { ALLOWED_MIME, MAX_FILES, TYPE_NOT_ALLOWED } = require('../middlewares/upload');
const schemas = require('../validation/schemas');
const phone = require('../functions/phoneUpload');
const { uploadBlob, sasUrl, logBlobError } = require('../functions/blob');
const { sniff } = require('../functions/documentsPdf');
const { writeAudit } = require('../functions/audit');

// "Hazles una foto con el móvil" (GON-78). The computer, signed in, asks for a link and lists
// what arrived; the phone, not signed in, sends photos with the link token. The record is
// always the session's or the token's, never one named by the client. The phone's answers
// carry no name or other personal data.

const EXPIRED = { message: 'Este enlace ha caducado. Pide un código nuevo en el ordenador.' };
const WRONG_CODE = { message: 'Ese código no sirve. Comprueba los 6 números o pide uno nuevo en el ordenador.' };
const NO_FILE = { message: 'Por favor envía una foto' };
const TOO_MANY = { message: `Ya hay ${MAX_FILES} archivos, el máximo. Quita alguno en el ordenador.` };

// The stored type comes from the file's first bytes, not from the client's claim.
const MIME_OF = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };

// Only the applicant: an admin session has no record of its own here.
const ownerOnly = (req, res, next) => (req.user.role === 'user' ? next() : res.status(403).json({ message: 'No autorizado' }));

const fail = (req, res, err, message) => {
	req.log && req.log.error({ err }, message);
	res.status(500).json({ message: 'Error interno' });
};

router.post('/token', authUser, ownerOnly, async (req, res) => {
	try {
		const { token, codigo, caduca } = await phone.createPhoneToken(req.user.id);
		writeAudit(req, { action: 'phone.token_create', actorType: 'user', actorId: req.user.id, target: req.user.id, outcome: 'success' });
		res.status(201).json({ token, codigo, caduca, minutos: phone.TOKEN_MINUTES });
	} catch (err) {
		fail(req, res, err, 'phone token create failed');
	}
});

router.post('/codigo', phoneCodeLimiter, validate(schemas.phoneCodeSchema), async (req, res) => {
	try {
		const token = await phone.exchangeCode(req.body.codigo);
		if (!token) return res.status(404).json(WRONG_CODE);
		res.json({ token });
	} catch (err) {
		fail(req, res, err, 'phone code exchange failed');
	}
});

router.get('/sesion/:token', phoneLimiter, async (req, res) => {
	try {
		const row = await phone.findPhoneToken(req.params.token);
		if (!row) return res.status(410).json(EXPIRED);
		await phone.markConnected(row);
		res.json({ caduca: row.caduca });
	} catch (err) {
		fail(req, res, err, 'phone session failed');
	}
});

router.post('/sesion/:token/fotos', phoneLimiter, validate(schemas.phoneUploadSchema), async (req, res) => {
	try {
		const row = await phone.findPhoneToken(req.params.token);
		if (!row) return res.status(410).json(EXPIRED);
		const files = Object.values(req.files || {}).flat();
		if (!files.length) return res.status(400).json(NO_FILE);
		const typed = [];
		for (const file of files) {
			const kind = ALLOWED_MIME.has(file.mimetype) && sniff(file.data);
			if (!kind) return res.status(400).json({ message: TYPE_NOT_ALLOWED });
			typed.push({ data: file.data, mimetype: MIME_OF[kind] });
		}
		if ((await phone.countStaged(row.usuarioId)) + typed.length > MAX_FILES) return res.status(400).json(TOO_MANY);

		await phone.markConnected(row);
		const saved = [];
		for (const file of typed) saved.push(await phone.addStaged(row.usuarioId, req.body.grupo, file, uploadBlob));
		writeAudit(req, {
			action: 'phone.upload',
			actorType: 'phone',
			target: row.usuarioId,
			outcome: 'success',
			meta: { archivos: saved.length },
		});
		res.status(201).json({ fotos: saved.map(({ id, grupo, orden }) => ({ id, grupo, orden })) });
	} catch (err) {
		fail(req, res, err, 'phone upload failed');
	}
});

router.get('/archivos', authUser, ownerOnly, async (req, res) => {
	try {
		const [rows, movilConectado] = await Promise.all([phone.listStaged(req.user.id), phone.phoneConnected(req.user.id)]);
		res.json({
			archivos: rows.map(row => ({
				id: row.id,
				grupo: row.grupo,
				orden: row.orden,
				creado: row.creadoEn,
				tipo: row.tipo,
				tamano: row.tamano,
				url: sasUrl(row.blob, 10),
			})),
			movilConectado,
		});
	} catch (err) {
		fail(req, res, err, 'staged list failed');
	}
});

router.delete('/archivos/:id', authUser, ownerOnly, async (req, res) => {
	try {
		const row = await phone.findOwnStaged(req.user.id, req.params.id);
		if (!row) return res.status(404).json({ message: 'No encontrado' });
		const result = await phone.removeStaged([row]);
		if (result.failed) logBlobError(req, result.error, 'staged photo blob not deleted');
		res.json({ borrado: true });
	} catch (err) {
		fail(req, res, err, 'staged delete failed');
	}
});

module.exports = router;
