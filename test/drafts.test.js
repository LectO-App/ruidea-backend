const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// Admin actions on unfinished applications (estado 'borrador'): progress, reminder email,
// cancel. Prisma, nodemailer and Azure storage are in-memory fakes. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.FRONTEND_URL = 'http://front.example.test';

const rows = [];
const audits = [];
const sent = [];
const blobs = new Set();

const matches = (row, where) =>
	Object.entries(where).every(([k, v]) => {
		if (k === 'OR') return v.some(w => matches(row, w));
		if (v && typeof v === 'object') {
			if ('not' in v) return row[k] !== v.not;
			if ('in' in v) return v.in.includes(row[k]);
			return false;
		}
		return row[k] === v;
	});

const fake = {
	usuario: {
		findUnique: async ({ where }) => rows.find(r => matches(r, where)) || null,
		findMany: async ({ where }) => rows.filter(r => matches(r, where)),
		delete: async ({ where }) => {
			const i = rows.findIndex(r => matches(r, where));
			if (i < 0) throw Object.assign(new Error('missing'), { code: 'P2025' });
			return rows.splice(i, 1)[0];
		},
	},
	auditLog: {
		create: async ({ data }) => audits.push({ at: new Date(), ...data }),
		groupBy: async ({ where }) => {
			const latest = new Map();
			for (const a of audits.filter(a => matches(a, where))) {
				if (!latest.has(a.target) || latest.get(a.target) < a.at) latest.set(a.target, a.at);
			}
			return [...latest].map(([target, at]) => ({ target, _max: { at } }));
		},
	},
};
require('../db/prisma').getPrisma = () => fake;
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });
require('azure-storage').createBlobService = () => ({
	listBlobsSegmentedWithPrefix(container, prefix, token, cb) {
		cb(null, { entries: [...blobs].filter(n => n.startsWith(prefix)).map(name => ({ name })), continuationToken: null });
	},
	deleteBlobIfExists(container, name, options, cb) {
		cb(null, blobs.delete(name));
	},
});

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');
const { draftProgress } = require('../functions/drafts');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const draft = (id, overrides = {}) => ({
	id,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	paisResidencia: null,
	localidadResidencia: null,
	lugarNacimiento: null,
	tipoDocumento: null,
	numeroDocumento: null,
	fechaNacimiento: new Date('2010-01-01T00:00:00Z'),
	correoElectronico: `${id}@example.test`,
	numeroTelefono: null,
	dislexia: false,
	discalculia: false,
	disortografia: false,
	dispraxia: false,
	tdah: false,
	esTutor: false,
	tutorNombre: '',
	tutorApellidos: '',
	tutorParentesco: '',
	password: 'not-a-real-hash',
	emailVerificado: false,
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	estado: 'borrador',
	mensajeMedico: '',
	numeroPasaporte: -1,
	aceptoRecibirInfo: false,
	aceptoSolicitud: false,
	fechaConsentimiento: null,
	fechaEnvio: null,
	archivoBlob: '',
	extra: null,
	...overrides,
});

const csrf = 'test-csrf';
const cookieFor = (id, role) => `token=${signToken({ id, role, csrf }, { expiresIn: '1h' })}`;
const ADMIN = cookieFor('admin', 'admin');

let server;
let base;
const call = (method, path, { body, cookie = ADMIN } = {}) =>
	fetch(base + path, {
		method,
		headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
		body: body && JSON.stringify(body),
	});

// The email and audit writes are fire-and-forget: wait for them to land.
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

before(async () => {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use('/admin', require('../routes/admin'));
	app.use('/usuario', require('../routes/usuario'));
	app.use('/emailVerification', require('../routes/emailVerification'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

beforeEach(() => {
	rows.length = 0;
	audits.length = 0;
	sent.length = 0;
	blobs.clear();
});

test('draftProgress marks each form step complete or missing from the saved fields', () => {
	const toUser = require('../models/modeloUsuario').toUsuario;
	const steps = u => Object.fromEntries(draftProgress(toUser(u)).pasos.map(p => [p.clave, p.completo]));

	assert.deepStrictEqual(steps(draft(A)), { datos: true, residencia: false, diagnostico: false, documentos: false, revision: false });
	assert.deepStrictEqual(
		steps(
			draft(A, {
				paisResidencia: 'España',
				localidadResidencia: 'Ciudad Ficticia',
				lugarNacimiento: 'Pueblo Ficticio',
				numeroDocumento: '00000000T',
				numeroTelefono: '+34600000000',
				tdah: true,
				archivoBlob: `${A}/2026-01-01T00:00:00.000Z.zip`,
			})
		),
		{ datos: true, residencia: true, diagnostico: true, documentos: true, revision: false }
	);
	assert.equal(steps(draft(A, { esTutor: true })).datos, false, 'a guardian must give their name');
	assert.equal(steps(draft(A, { nombre: null })).datos, false);
	assert.deepStrictEqual(draftProgress(toUser(draft(A))).pasos[0], { clave: 'datos', titulo: 'Tus datos', completo: true });
});

test('the solicitudes list adds progress and the last reminder to draft rows only', async () => {
	rows.push(draft(A), draft(B, { estado: 'pendiente' }));
	const at = new Date('2026-03-02T10:00:00Z');
	audits.push(
		{ action: 'admin.draft_reminder', target: A, at: new Date('2026-03-01T10:00:00Z') },
		{ action: 'admin.draft_reminder', target: A, at },
		{ action: 'admin.resend_verification', target: A, at: new Date('2026-04-01T10:00:00Z') }
	);
	const res = await call('POST', '/admin/solicitudes', { body: { condicion: 'todas' } });
	assert.equal(res.status, 200);
	const list = await res.json();
	const a = list.find(u => u._id === A);
	const b = list.find(u => u._id === B);
	assert.equal(a.ultimoRecordatorio, at.toISOString());
	assert.equal(a.progreso.pasos.length, 5);
	assert.equal(b.progreso, undefined);
	assert.equal(b.ultimoRecordatorio, undefined);
});

test('a draft owner sees their progress in /usuario/me', async () => {
	rows.push(draft(A, { tokenVersion: 0 }));
	const res = await call('GET', '/usuario/me', { cookie: cookieFor(A, 'user') });
	assert.equal(res.status, 200);
	const me = await res.json();
	assert.deepStrictEqual(
		me.progreso.pasos.filter(p => !p.completo).map(p => p.clave),
		['residencia', 'diagnostico', 'documentos', 'revision']
	);
});

test('the reminder emails a draft what is missing, links to login, and writes an audit entry', async () => {
	rows.push(draft(A, { nombre: '<b>Ana</b>' }));
	const res = await call('POST', `/admin/borradores/${A}/recordatorio`);
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.ok, true);
	assert.ok(!Number.isNaN(Date.parse(body.ultimoRecordatorio)));
	await settle();

	assert.equal(sent.length, 1);
	const [mail] = sent;
	assert.equal(mail.to, `${A}@example.test`);
	assert.match(mail.subject, /aún no está enviada/);
	assert.match(mail.html, /no está terminada/);
	assert.match(mail.html, /Residencia y documento/);
	assert.match(mail.html, /Diagnóstico/);
	assert.match(mail.html, /Revisar y enviar/);
	assert.doesNotMatch(mail.html, /<li[^>]*>Tus datos/, 'a complete step is not listed as missing');
	assert.match(mail.html, /Olvidé mi contraseña/);
	assert.match(mail.html, /href="http:\/\/front\.example\.test\/login"/);
	assert.ok(!mail.html.includes('<b>Ana</b>'), 'the name is HTML-escaped');
	assert.match(mail.text, /http:\/\/front\.example\.test\/login/);

	assert.deepStrictEqual(
		audits.map(a => [a.action, a.actorType, a.target, a.outcome]),
		[['admin.draft_reminder', 'admin', A, 'success']]
	);
	assert.equal(audits[0].meta, undefined, 'no personal data in the audit entry');
});

test('the reminder answers 409 for an application that was already sent, and sends nothing', async () => {
	rows.push(draft(A, { estado: 'pendiente' }));
	const res = await call('POST', `/admin/borradores/${A}/recordatorio`);
	assert.equal(res.status, 409);
	await settle();
	assert.equal(sent.length, 0);
	assert.equal(audits.length, 0);
});

test('the reminder answers 404 for an unknown or malformed id', async () => {
	assert.equal((await call('POST', `/admin/borradores/${B}/recordatorio`)).status, 404);
	assert.equal((await call('POST', '/admin/borradores/nope/recordatorio')).status, 404);
});

test('draft reminder and cancel are admin only', async () => {
	rows.push(draft(A, { tokenVersion: 0 }));
	const userCookie = cookieFor(A, 'user');
	assert.equal((await call('POST', `/admin/borradores/${A}/recordatorio`, { cookie: userCookie })).status, 403);
	assert.equal((await call('POST', `/admin/borradores/${A}/cancelar`, { cookie: userCookie, body: {} })).status, 403);
	assert.equal((await call('POST', `/admin/borradores/${A}/cancelar`, { cookie: '', body: {} })).status, 401);
	await settle();
	assert.equal(rows.length, 1);
	assert.equal(sent.length, 0);
});

test('cancel deletes the draft and every uploaded document, audits it and tells the person', async () => {
	rows.push(draft(A, { archivoBlob: `${A}/2026-02-01T00:00:00.000Z.zip` }), draft(B));
	blobs.add(`${A}/2026-01-01T00:00:00.000Z.zip`).add(`${A}/2026-02-01T00:00:00.000Z.zip`).add(`${B}/2026-01-01T00:00:00.000Z.zip`);

	const res = await call('POST', `/admin/borradores/${A}/cancelar`, { body: { avisar: true } });
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await res.json(), { ok: true });
	await settle();

	assert.deepStrictEqual(rows.map(r => r.id), [B]);
	assert.deepStrictEqual([...blobs], [`${B}/2026-01-01T00:00:00.000Z.zip`]);
	assert.deepStrictEqual(
		audits.map(a => [a.action, a.actorType, a.target, a.outcome]),
		[['admin.draft_cancel', 'admin', A, 'success']]
	);
	assert.deepStrictEqual(audits[0].meta, { avisado: true });

	assert.equal(sent.length, 1);
	assert.equal(sent[0].to, `${A}@example.test`);
	assert.match(sent[0].html, /cancelado/);
	assert.match(sent[0].html, /href="http:\/\/front\.example\.test\/inscribirse"/);
});

test('cancel without avisar sends no email', async () => {
	rows.push(draft(A));
	const res = await call('POST', `/admin/borradores/${A}/cancelar`, { body: { avisar: false } });
	assert.equal(res.status, 200);
	await settle();
	assert.equal(rows.length, 0);
	assert.equal(sent.length, 0);
	assert.deepStrictEqual(audits[0].meta, { avisado: false });
});

test('cancel refuses an application that is not a draft and keeps it', async () => {
	rows.push(draft(A, { estado: 'aceptado', numeroPasaporte: 1001 }));
	blobs.add(`${A}/2026-01-01T00:00:00.000Z.zip`);
	const res = await call('POST', `/admin/borradores/${A}/cancelar`, { body: { avisar: true } });
	assert.equal(res.status, 409);
	await settle();
	assert.equal(rows.length, 1);
	assert.equal(blobs.size, 1);
	assert.equal(sent.length, 0);
	assert.equal(audits.length, 0);
});

test('cancel answers 404 for an unknown id', async () => {
	const res = await call('POST', `/admin/borradores/${B}/cancelar`, { body: {} });
	assert.equal(res.status, 404);
});

// The verification email says a specialist will review the application: never true for a draft.
test('admin resend refuses a draft and sends no verification email', async () => {
	rows.push(draft(A));
	const res = await call('POST', `/admin/resend/${A}`);
	assert.equal(res.status, 409);
	await settle();
	assert.equal(sent.length, 0);
	assert.equal(audits.length, 0);
});

test('admin resend still sends the verification email to a sent application', async () => {
	rows.push(draft(A, { estado: 'pendiente' }));
	assert.equal((await call('POST', `/admin/resend/${A}`)).status, 200);
	await settle();
	assert.equal(sent.length, 1);
	assert.match(sent[0].subject, /Confirma tu correo/);
});

test('a draft owner cannot resend the verification email to themselves', async () => {
	rows.push(draft(A, { tokenVersion: 0 }));
	const res = await call('POST', '/emailVerification/resend', { cookie: cookieFor(A, 'user') });
	assert.equal(res.status, 409);
	assert.match((await res.json()).message, /aún no está enviada/);
	await settle();
	assert.equal(sent.length, 0);
});

test('the resend link from an old token sends nothing to a draft', async () => {
	rows.push(draft(A));
	const token = signToken({ id: A, purpose: 'email-verify' }, { expiresIn: -10 });
	assert.equal((await call('POST', `/emailVerification/resend/${token}`, { cookie: '' })).status, 200);
	await settle();
	assert.equal(sent.length, 0);

	rows[0].estado = 'pendiente';
	assert.equal((await call('POST', `/emailVerification/resend/${token}`, { cookie: '' })).status, 200);
	await settle();
	assert.equal(sent.length, 1);
});
