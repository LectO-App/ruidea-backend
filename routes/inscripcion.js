const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Zip = require('jszip');

const Usuario = require('../models/modeloUsuario');
const { issueSession, authUser, authAdmin } = require('../middlewares/session');
const { registerLimiter } = require('../middlewares/rate-limit');
const { validate } = require('../middlewares/validate');
const schemas = require('../validation/schemas');
const { uploadZip, sasUrl, deleteBlob } = require('../functions/blob');
const { writeAudit } = require('../functions/audit');
const { suggestEmail } = require('../validation/identity');

const { sendEmail } = require('../functions/sendEmail');

// Accept the formats people actually have: a generated PDF, or a phone photo / scan of
// a paper diagnosis report (REGISTRATION_UX.md §5). PDF-only was a real-world barrier.
const ALLOWED_MIME = new Set([
	'application/pdf',
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/heic',
	'image/heif',
]);
const MAX_FILES = 10;

// Days the medical review typically takes — surfaced to the user on the completion
// screen so "what happens next" has an honest timeline (§7).
const REVIEW_SLA_DAYS = 5;

const isValidId = id => mongoose.isValidObjectId(id);

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
		const filter = req.query.includeDrafts === 'true' ? {} : { estado: { $ne: 'borrador' } };
		const [users, total] = await Promise.all([
			Usuario.find(filter).sort({ fechaCreacion: -1 }).skip((page - 1) * limit).limit(limit),
			Usuario.countDocuments(filter),
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
		const existing = await Usuario.findOne({ correoElectronico: req.body.correoElectronico }).select('estado');
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
		if (err.code === 11000) return res.status(409).json({ message: 'El correo ya está registrado' });
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
		const current = await Usuario.findById(req.params.id).select('estado');
		if (!current) return res.status(404).json({ message: 'No encontrado' });
		if (current.estado !== 'borrador') {
			return res.status(409).json({ message: 'La solicitud ya fue enviada. Usa "actualizar" para cambios.' });
		}
		const update = await Usuario.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
		res.json({ usuario: update, guardado: true });
	} catch (err) {
		req.log && req.log.error({ err }, 'autosave failed');
		if (err.code === 11000) return res.status(409).json({ message: 'El correo ya está registrado' });
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

		const set = {
			...result.data,
			estado: 'pendiente',
			fechaEnvio: new Date(),
			fechaConsentimiento: doc.fechaConsentimiento || new Date(),
		};
		const saved = await Usuario.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });

		// Fire-and-forget: a slow/failing SMTP send must not block or fail submission.
		sendEmail(saved._id).catch(err => req.log && req.log.error({ err }, 'verification email failed'));
		writeAudit(req, { action: 'user.submit', actorType: 'user', actorId: req.user.id, outcome: 'success' });
		res.json({ usuario: saved, ...completionPayload(saved) });
	} catch (err) {
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
		if (err.code === 11000) return res.status(409).json({ message: 'El correo ya está registrado' });
		res.status(400).json({ message: 'No se pudo completar el registro' });
	}
});

// Upload identity/diagnosis documents for the AUTHENTICATED user. Server-side type +
// count validation; blob keyed by record id, not client input (§3.1, §11.3). Accepts
// PDFs and images (a phone photo of a paper report, §5).
router.post('/subir-archivos', authUser, async (req, res) => {
	if (!req.files || Object.keys(req.files).length === 0) {
		return res.status(400).json({ message: 'Por favor envía un archivo' });
	}
	try {
		const files = Object.values(req.files).flat();
		if (files.length > MAX_FILES) return res.status(400).json({ message: 'Demasiados archivos' });
		for (const file of files) {
			if (!ALLOWED_MIME.has(file.mimetype)) {
				return res.status(400).json({ message: 'Solo se permiten archivos PDF o imágenes (JPG, PNG)' });
			}
		}

		const zip = new Zip();
		for (const file of files) zip.file(file.name, file.data);
		const buffer = await zip.generateAsync({
			type: 'nodebuffer',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 },
		});

		const blobName = `${req.user.id}/${new Date().toISOString()}.zip`;
		await uploadZip(blobName, buffer);
		await Usuario.findByIdAndUpdate(req.user.id, { archivoBlob: blobName });

		writeAudit(req, { action: 'docs.upload', actorType: 'user', actorId: req.user.id, outcome: 'success' });
		res.json({ message: 'Documentos subidos', archivos: files.length });
	} catch (err) {
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

		const user = await Usuario.findById(req.params.id).select('archivoBlob');
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

		const update = await Usuario.findByIdAndUpdate(body._id, { $set: set }, { new: true });
		writeAudit(req, { action: 'user.update', actorType: req.user.role, actorId: req.user.id, target: body._id, outcome: 'success' });
		res.json({ update });
	} catch (err) {
		req.log && req.log.error({ err }, 'actualizar failed');
		if (err.code === 11000) return res.status(409).json({ message: 'El correo ya está registrado' });
		res.status(400).json({ message: 'No se pudo actualizar' });
	}
});

router.post('/comprobar-mail', validate(schemas.emailSchema), async (req, res) => {
	try {
		const exists = await Usuario.exists({ correoElectronico: req.body.mail });
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
		const user = await Usuario.findByIdAndDelete(req.params.id);
		if (user && user.archivoBlob) await deleteBlob(user.archivoBlob); // don't orphan PII docs (§3.3)
		writeAudit(req, { action: 'user.delete', actorType: 'admin', actorId: req.user.id, target: req.params.id, outcome: user ? 'success' : 'not_found' });
		res.json({ message: 'Eliminado', user });
	} catch (err) {
		req.log && req.log.error({ err }, 'delete failed');
		res.status(500).json({ message: 'Error interno' });
	}
});

module.exports = router;
