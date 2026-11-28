const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const Usuario = require('../models/modeloUsuario');
const { isValidObjectId: isValidId } = require('../db/objectId');
const { isUniqueViolation } = require('../db/prisma');
const { issueSession, authUser, authAdmin } = require('../middlewares/session');
const { registerLimiter, emailLimiter } = require('../middlewares/rate-limit');
const { validate } = require('../middlewares/validate');
const schemas = require('../validation/schemas');
const { uploadPdf, downloadBlob, isPdfBlob, sasUrl, deleteBlob, deleteUserDocuments, logBlobError } = require('../functions/blob');
const { combineDocuments, DocumentFileError, errorMessage } = require('../functions/documentsPdf');
const { writeAudit } = require('../functions/audit');
const { suggestEmail } = require('../validation/identity');

const { listStaged, removeStaged } = require('../functions/phoneUpload');
const { ALLOWED_MIME, MAX_FILES, TYPE_NOT_ALLOWED } = require('../middlewares/upload');

const { sendEmail } = require('../functions/sendEmail');

const OLD_ZIP_CANNOT_GROW =
	'Tus documentos actuales están guardados en un formato antiguo y no se pueden ampliar. Elige «Cambiarlos por los nuevos» y súbelos todos otra vez.';

// The files of one upload and the record's staged phone photos, in page order: first as
// `orden` lists them ("archivo:<field name>" / "movil:<id>"), then the ones it leaves out
// (the request's files in the order sent, then the staged photos).
const pageOrder = (req, staged, orden) => {
	const items = [
		...Object.entries(req.files || {}).flatMap(([field, value]) =>
			(Array.isArray(value) ? value : [value]).map(file => ({ key: `archivo:${field}`, file }))
		),
		...staged.map(row => ({ key: `movil:${row.id}`, row })),
	];
	const used = new Set();
	const ordered = [];
	for (const key of orden) {
		const i = items.findIndex((item, j) => !used.has(j) && item.key === key);
		if (i >= 0) {
			used.add(i);
			ordered.push(items[i]);
		}
	}
	items.forEach((item, j) => used.has(j) || ordered.push(item));
	return ordered;
};

// Joins the items into one new PDF for the record (after its current PDF with modo=agregar),
// stores it, and deletes the previous blob and the joined staged photos. New documents
// behind an issued passport have not been reviewed: an accepted record goes back to
// 'pendiente', keeping its passport number. Rejects with a DocumentFileError for a file that
// cannot be added. Returns { archivoBlob } or { refused: { status, message } }.
const joinDocuments = async (req, current, items, modo) => {
	let base = null;
	if (modo === 'agregar' && current.archivoBlob) {
		if (!isPdfBlob(current.archivoBlob)) return { refused: { status: 409, message: OLD_ZIP_CANNOT_GROW } };
		base = await downloadBlob(current.archivoBlob);
	}
	const inputs = [];
	let photo = 0;
	for (const item of items) {
		if (item.file) inputs.push(item.file);
		else inputs.push({ name: `Foto del móvil ${++photo}`, data: await downloadBlob(item.row.blob), mimetype: item.row.tipo });
	}

	const buffer = await combineDocuments(inputs, { base });
	const blobName = `${current._id}/${new Date().toISOString()}.pdf`;
	await uploadPdf(blobName, buffer);
	const set = { archivoBlob: blobName };
	if (current.estado === 'aceptado') set.estado = 'pendiente';
	await Usuario.updateById(current._id, set);
	// Best-effort: superseded ID and diagnosis documents should not stay in storage, but the
	// upload stands when they cannot be deleted.
	if (current.archivoBlob && current.archivoBlob !== blobName) {
		await deleteBlob(current.archivoBlob).catch(err => logBlobError(req, err, 'superseded documents not deleted'));
	}
	const removed = await removeStaged(items.filter(item => item.row).map(item => item.row));
	if (removed.failed) logBlobError(req, removed.error, 'joined phone photos not deleted', { failed: removed.failed });
	return { archivoBlob: blobName };
};

// Days the medical review typically takes — surfaced to the user on the completion
// screen so "what happens next" has an honest timeline (§7).
const REVIEW_SLA_DAYS = 5;

// The shared "what happens next" payload returned after a completed submission (§7).
// The frontend turns this into a real completion moment instead of guessing.
const completionPayload = saved => ({
	estado: saved.estado,
	pasos: ['verifica-email', 'revision-medica', 'pasaporte-emitido'],
	siguientePaso: saved.emailVerificado ? 'revision-medica' : 'verifica-email',
	mensaje: `¡Listo${saved.nombre ? `, ${saved.nombre}` : ''}! Tu solicitud está en camino.`,
	revisionEstimadaDias: REVIEW_SLA_DAYS,
});

// Plain object of the application fields held on a draft record, so submitSchema can
// re-validate the accumulated autosaves at submission time.
const applicationFields = doc => ({
	nombre: doc.nombre,
	apellidos: doc.apellidos,
	paisResidencia: doc.paisResidencia,
	localidadResidencia: doc.localidadResidencia,
	lugarNacimiento: doc.lugarNacimiento,
	tipoDocumento: doc.tipoDocumento || undefined,
	numeroDocumento: doc.numeroDocumento,
	fechaNacimiento: doc.fechaNacimiento,
	correoElectronico: doc.correoElectronico,
	numeroTelefono: doc.numeroTelefono,
	diagnostico: doc.diagnostico && {
		dislexia: doc.diagnostico.dislexia,
		discalculia: doc.diagnostico.discalculia,
		disortografía: doc.diagnostico.disortografía,
		dispraxia: doc.diagnostico.dispraxia,
		tdah: doc.diagnostico.tdah,
	},
	esTutor: doc.esTutor,
	tutorNombre: doc.tutorNombre || undefined,
	tutorApellidos: doc.tutorApellidos || undefined,
	tutorParentesco: doc.tutorParentesco || undefined,
	aceptoRecibirInfo: doc.aceptoRecibirInfo,
	aceptoSolicitud: doc.aceptoSolicitud,
});

// List all users — admin only, projected (no hash via toJSON), paginated. Drafts are
// hidden by default (§6.2, §2.2).
router.get('/', authAdmin, async (req, res) => {
	try {
		const page = Math.max(1, parseInt(req.query.page, 10) || 1);
		const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
		const filter = req.query.includeDrafts === 'true' ? {} : { estadoNot: 'borrador' };
		const [users, total] = await Promise.all([
			Usuario.find(filter, { sort: 'newest', skip: (page - 1) * limit, limit }),
			Usuario.count(filter),
		]);
		res.json({ users, page, limit, total });
	} catch (err) {
		req.log && req.log.error({ err }, 'list users failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

// --- Step 1: create the account (§1). Email + password → a `borrador` record + session,
// so the long application can be filled progressively and resumed. ~15 seconds.
router.post('/draft', registerLimiter, validate(schemas.draftStartSchema), async (req, res) => {
	try {
		const existing = await Usuario.findByEmail(req.body.correoElectronico);
		if (existing) {
			// Don't silently fork accounts; tell them to sign in / resume instead.
			return res.status(409).json({ message: 'Ya existe una cuenta con este correo. Inicia sesión para continuar.' });
		}
		const saved = await Usuario.create({
			correoElectronico: req.body.correoElectronico,
			password: await bcrypt.hash(req.body.password, 10),
			estado: 'borrador',
			fechaCreacion: Date.now(),
			emailVerificado: false,
			numeroPasaporte: -1,
		});
		const csrf = issueSession(res, { id: String(saved._id), role: 'user' });
		writeAudit(req, { action: 'user.draft_create', actorType: 'user', actorId: String(saved._id), outcome: 'success' });
		res.status(201).json({ id: String(saved._id), usuario: saved, csrfToken: csrf, siguientePaso: 'datos-personales' });
	} catch (err) {
		req.log && req.log.error({ err }, 'draft create failed');
		if (isUniqueViolation(err)) return res.status(409).json({ message: 'El correo ya está registrado' });
		res.status(400).json({ message: 'No se pudo crear la cuenta' });
	}
});

// Resume support: the owner fetches their own in-progress draft (§1, "save & continue").
router.get('/borrador', authUser, async (req, res) => {
	try {
		const user = await Usuario.findById(req.user.id);
		if (!user) return res.status(404).json({ message: 'No encontrado' });
		res.json({ usuario: user });
	} catch (err) {
		req.log && req.log.error({ err }, 'load draft failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

// --- Autosave: debounced partial saves of one step. Owner-only, drafts only. Every
// field optional so a half-filled step persists without complaint (§1, §4). ---
router.patch('/:id', authUser, validate(schemas.draftPatchSchema), async (req, res) => {
	try {
		if (req.user.id !== req.params.id) return res.status(403).json({ message: 'No autorizado' });
		const current = await Usuario.findById(req.params.id);
		if (!current) return res.status(404).json({ message: 'No encontrado' });
		if (current.estado !== 'borrador') {
			return res.status(409).json({ message: 'La solicitud ya fue enviada. Usa "actualizar" para cambios.' });
		}
		const update = await Usuario.updateById(req.params.id, req.body);
		res.json({ usuario: update, guardado: true });
	} catch (err) {
		req.log && req.log.error({ err }, 'autosave failed');
		if (isUniqueViolation(err)) return res.status(409).json({ message: 'El correo ya está registrado' });
		res.status(400).json({ message: 'No se pudo guardar' });
	}
});

// --- Step final: submit the completed application for review (§1, §7). Validates the
// accumulated draft (plus any last-step values in the body) with the strict schema,
// flips borrador → pendiente, stamps consent + submission time, fires the email.
// Idempotent: re-submitting an already-submitted application just returns its status. ---
router.post('/:id/enviar', authUser, async (req, res) => {
	try {
		if (req.user.id !== req.params.id) return res.status(403).json({ message: 'No autorizado' });
		const doc = await Usuario.findById(req.params.id);
		if (!doc) return res.status(404).json({ message: 'No encontrado' });

		// Idempotency: a double-tap (dyspraxia §2) or retry must not re-process or re-email.
		if (doc.estado !== 'borrador') {
			return res.json({ usuario: doc, yaEnviada: true, ...completionPayload(doc) });
		}

		const candidate = { ...applicationFields(doc), ...req.body };
		const result = schemas.submitSchema.safeParse(candidate);
		if (!result.success) {
			return res.status(400).json({
				message: 'Faltan datos o hay errores',
				errors: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
			});
		}

		// Phone photos not yet joined (they arrived after the last upload, or the person sent
		// only phone photos) go after the documents stored now.
		const staged = await listStaged(doc._id);
		if (staged.length) {
			const joined = await joinDocuments(req, doc, pageOrder(req, staged, []), 'agregar');
			if (joined.refused) return res.status(joined.refused.status).json({ message: joined.refused.message });
		}

		const set = {
			...result.data,
			estado: 'pendiente',
			fechaEnvio: new Date(),
			fechaConsentimiento: doc.fechaConsentimiento || new Date(),
		};
		const saved = await Usuario.updateById(req.params.id, set);

		// Fire-and-forget: a slow/failing SMTP send must not block or fail submission.
		sendEmail(saved._id).catch(err => req.log && req.log.error({ err }, 'verification email failed'));
		writeAudit(req, { action: 'user.submit', actorType: 'user', actorId: req.user.id, outcome: 'success' });
		res.json({ usuario: saved, ...completionPayload(saved) });
	} catch (err) {
		if (err instanceof DocumentFileError) {
			req.log && req.log.warn({ kind: err.kind }, 'submit: phone photos rejected');
			return res.status(422).json({ message: errorMessage(err) });
		}
		req.log && req.log.error({ err }, 'submit failed');
		res.status(400).json({ message: 'No se pudo enviar la solicitud' });
	}
});

// --- Legacy one-shot registration: validated, hashes password, persists consent,
// auto-issues a session, and submits in a single call. Kept for backward compatibility;
// the stepped draft flow above is preferred. ---
router.post('/', registerLimiter, validate(schemas.registerSchema), async (req, res) => {
	try {
		const user = { ...req.body };
		user.password = await bcrypt.hash(user.password, 10);
		user.fechaNacimiento = new Date(user.fechaNacimiento);
		user.fechaCreacion = Date.now();
		user.fechaEnvio = new Date();
		if (user.aceptoSolicitud) user.fechaConsentimiento = new Date();
		// Force server-controlled fields regardless of input.
		user.estado = 'pendiente';
		user.numeroPasaporte = -1;
		user.emailVerificado = false;

		const saved = await Usuario.create(user);
		// Fire-and-forget: a slow/failing SMTP send must not block or fail registration.
		sendEmail(saved._id).catch(err => req.log && req.log.error({ err }, 'verification email failed'));

		const csrf = issueSession(res, { id: String(saved._id), role: 'user' });
		writeAudit(req, { action: 'user.register', actorType: 'user', actorId: String(saved._id), outcome: 'success' });
		res.json({ usuario: saved, csrfToken: csrf, ...completionPayload(saved) });
	} catch (err) {
		req.log && req.log.error({ err }, 'register failed');
		if (isUniqueViolation(err)) return res.status(409).json({ message: 'El correo ya está registrado' });
		res.status(400).json({ message: 'No se pudo completar el registro' });
	}
});

// Upload identity/diagnosis documents for the AUTHENTICATED user. Server-side type +
// count validation; blob keyed by record id, not client input (§3.1, §11.3). Accepts
// PDFs and images (a phone photo of a paper report, §5), and stores them, with the photos
// sent from the phone (routes/movil.js), as one PDF in the order of `orden`, so the
// reviewer opens a single document. With modo=agregar the new files go after the pages of
// the PDF stored now; either way the result is a new blob. Rejecting an upload to an
// accepted record instead of sending it back to review would break the edit flow, which
// uploads before calling /actualizar.
router.post('/subir-archivos', authUser, validate(schemas.uploadSchema), async (req, res) => {
	const files = Object.values(req.files || {}).flat();
	let items = [];
	try {
		if (files.length > MAX_FILES) return res.status(400).json({ message: 'Demasiados archivos' });
		for (const file of files) {
			if (!ALLOWED_MIME.has(file.mimetype)) return res.status(400).json({ message: TYPE_NOT_ALLOWED });
		}

		const current = await Usuario.findById(req.user.id);
		if (!current) return res.status(404).json({ message: 'Usuario no encontrado' });

		items = pageOrder(req, await listStaged(current._id), req.body.orden);
		if (!items.length) return res.status(400).json({ message: 'Por favor envía un archivo' });
		if (items.length > MAX_FILES) return res.status(400).json({ message: 'Demasiados archivos' });

		const joined = await joinDocuments(req, current, items, req.body.modo);
		if (joined.refused) return res.status(joined.refused.status).json({ message: joined.refused.message });

		const movil = items.filter(item => item.row).length;
		writeAudit(req, { action: 'docs.upload', actorType: 'user', actorId: req.user.id, outcome: 'success', meta: { archivos: items.length, movil } });
		res.json({ message: 'Documentos subidos', archivos: items.length, archivoBlob: joined.archivoBlob });
	} catch (err) {
		if (err instanceof DocumentFileError) {
			// Only the count and the kind: file names and contents are personal data.
			req.log && req.log.warn({ kind: err.kind, archivos: items.length }, 'upload rejected');
			return res.status(422).json({ message: errorMessage(err) });
		}
		req.log && req.log.error({ err }, 'upload failed');
		res.status(500).json({ message: 'Error al subir el archivo' });
	}
});

// Short-lived SAS link to a user's documents. Admin, or the owner. Reads the stored
// blob path instead of listing/substring-matching the whole container (§3.2, §6.1).
router.get('/link-archivos/:id', authUser, async (req, res) => {
	try {
		if (req.user.role !== 'admin' && req.user.id !== req.params.id)
			return res.status(403).json({ message: 'No autorizado' });

		const user = await Usuario.findById(req.params.id);
		if (!user || !user.archivoBlob) return res.status(404).json({ message: 'Sin documentos' });

		writeAudit(req, { action: 'docs.access', actorType: req.user.role, actorId: req.user.id, target: req.params.id });
		res.json({ url: sasUrl(user.archivoBlob, 5) });
	} catch (err) {
		req.log && req.log.error({ err }, 'link-archivos failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

// Self-service profile edit. Only the owner; never re-hashes the password unless a new
// one is supplied; only re-enters review when actually changed (§5.4, §11.7).
router.put('/actualizar', authUser, validate(schemas.updateSchema), async (req, res) => {
	try {
		const body = req.body;
		if (req.user.role !== 'admin' && req.user.id !== body._id)
			return res.status(403).json({ message: 'No autorizado' });

		const set = {
			nombre: body.nombre,
			apellidos: body.apellidos,
			paisResidencia: body.paisResidencia,
			localidadResidencia: body.localidadResidencia,
			lugarNacimiento: body.lugarNacimiento,
			tipoDocumento: body.tipoDocumento || null,
			numeroDocumento: body.numeroDocumento,
			fechaNacimiento: new Date(body.fechaNacimiento),
			correoElectronico: body.correoElectronico,
			numeroTelefono: body.numeroTelefono,
			diagnostico: body.diagnostico,
			esTutor: body.esTutor,
			tutorNombre: body.tutorNombre || '',
			tutorApellidos: body.tutorApellidos || '',
			tutorParentesco: body.tutorParentesco || '',
			estado: 'pendiente', // edits go back to review, but keep existing passport number
		};
		if (typeof body.password === 'string' && body.password.length >= 8) {
			set.password = await bcrypt.hash(body.password, 10);
		}

		const update = await Usuario.updateById(body._id, set);
		// A new password ends the account's existing sessions (tokenVersion). The owner's own
		// session is reissued so they stay signed in; the SPA picks up the new csrfToken.
		let csrfToken;
		if (set.password && update) {
			const tokenVersion = await Usuario.bumpTokenVersion(body._id);
			if (req.user.id === body._id && tokenVersion != null) {
				csrfToken = issueSession(res, { id: body._id, role: 'user', tokenVersion });
			}
		}
		writeAudit(req, { action: 'user.update', actorType: req.user.role, actorId: req.user.id, target: body._id, outcome: 'success' });
		res.json(csrfToken ? { update, csrfToken } : { update });
	} catch (err) {
		req.log && req.log.error({ err }, 'actualizar failed');
		if (isUniqueViolation(err)) return res.status(409).json({ message: 'El correo ya está registrado' });
		res.status(400).json({ message: 'No se pudo actualizar' });
	}
});

// Answers whether an address is registered, so it gets the same per-IP limit as the other
// unauthenticated email endpoints (forgot-password, resend).
router.post('/comprobar-mail', emailLimiter, validate(schemas.emailSchema), async (req, res) => {
	try {
		const exists = await Usuario.emailExists(req.body.mail);
		// Surface a typo suggestion ("¿quisiste decir gmail.com?") alongside availability (§3).
		res.json({ disponible: !exists, sugerencia: suggestEmail(req.body.mail) });
	} catch (err) {
		req.log && req.log.error({ err }, 'comprobar-mail failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

router.delete('/:id', authAdmin, async (req, res) => {
	try {
		if (!isValidId(req.params.id)) return res.status(404).json({ message: 'No encontrado' });
		const user = await Usuario.deleteById(req.params.id);
		// Don't orphan PII docs (§3.3): every upload of this person, not only the current zip.
		const docs = user ? await deleteUserDocuments(user._id, user.archivoBlob) : null;
		if (docs && docs.failed) logBlobError(req, docs.error, 'user documents not fully deleted', { failed: docs.failed });
		writeAudit(req, { action: 'user.delete', actorType: 'admin', actorId: req.user.id, target: req.params.id, outcome: user ? 'success' : 'not_found' });
		res.json({ message: 'Eliminado', user });
	} catch (err) {
		req.log && req.log.error({ err }, 'delete failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

module.exports = router;
