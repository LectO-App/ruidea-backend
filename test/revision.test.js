const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Guided revision: the reasons a specialist gives, the groups the applicant changes since,
// and the revision email. Real routes against an in-memory stand-in for the Prisma client;
// all data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const rows = [];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row);
const fake = {
	usuario: {
		findUnique: async ({ where, select }) => {
			const row = rows.find(r => matches(r, where));
			return row ? pick(row, select) : null;
		},
		update: async ({ where, data }) => {
			const row = rows.find(r => matches(r, where));
			if (!row) throw Object.assign(new Error('missing'), { code: 'P2025' });
			Object.assign(row, data);
			return row;
		},
	},
	auditLog: { create: async () => ({}) },
};
require('../db/prisma').getPrisma = () => fake;

const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });

const uploaded = [];
const blob = require('../functions/blob');
blob.uploadZip = async name => uploaded.push(name);
blob.deleteBlob = async () => {};

const express = require('express');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const { signToken } = require('../functions/tokens');
const schemas = require('../validation/schemas');
const { MOTIVOS, motivoById } = require('../validation/motivosRevision');
const { sendEmailAdmin } = require('../functions/sendEmail');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CSRF = 'test-csrf';

const user = (overrides = {}) => ({
	id: A,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	paisResidencia: 'Argentina',
	localidadResidencia: 'Ciudad Ficticia',
	lugarNacimiento: 'Pueblo Ficticio',
	tipoDocumento: null,
	numeroDocumento: 'SINT-0001',
	fechaNacimiento: new Date('2010-01-01T00:00:00Z'),
	correoElectronico: `${A}@example.test`,
	numeroTelefono: '+5491136622676',
	dislexia: true,
	discalculia: false,
	disortografia: false,
	dispraxia: false,
	tdah: false,
	esTutor: false,
	tutorNombre: '',
	tutorApellidos: '',
	tutorParentesco: '',
	password: 'not-a-real-hash',
	emailVerificado: true,
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	estado: 'revision',
	mensajeMedico: '',
	motivosRevision: ['informe-ilegible', 'numero-documento'],
	cambiosDesdeRevision: [],
	numeroPasaporte: -1,
	aceptoRecibirInfo: false,
	aceptoSolicitud: true,
	fechaConsentimiento: null,
	fechaEnvio: null,
	archivoBlob: '',
	extra: null,
	tokenVersion: 0,
	...overrides,
});
const reset = (...list) => {
	rows.splice(0, rows.length, ...list);
	sent.length = 0;
	uploaded.length = 0;
};

let server;
let base;
before(async () => {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use(fileUpload());
	app.use('/admin', require('../routes/admin'));
	app.use('/usuario', require('../routes/usuario'));
	app.use('/inscripcion', require('../routes/inscripcion'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const sessions = {
	admin: `token=${signToken({ id: 'admin', role: 'admin', csrf: CSRF }, { expiresIn: '1h' })}`,
	user: `token=${signToken({ id: A, role: 'user', csrf: CSRF, tv: 0 }, { expiresIn: '1h' })}`,
};
const call = async (method, path, { as, body, form } = {}) => {
	const headers = { cookie: sessions[as], 'x-csrf-token': CSRF };
	if (body) headers['content-type'] = 'application/json';
	const res = await fetch(base + path, { method, headers, body: form || (body && JSON.stringify(body)) });
	return { status: res.status, data: await res.json() };
};

// The full body the edit form sends: the stored record, with `changes` on top.
const actualizar = changes => ({
	_id: A,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	paisResidencia: 'Argentina',
	localidadResidencia: 'Ciudad Ficticia',
	lugarNacimiento: 'Pueblo Ficticio',
	numeroDocumento: 'SINT-0001',
	fechaNacimiento: '2010-01-01T00:00:00.000Z',
	correoElectronico: `${A}@example.test`,
	numeroTelefono: '+5491136622676',
	diagnostico: { dislexia: true, discalculia: false, disortografía: false, dispraxia: false, tdah: false },
	esTutor: false,
	...changes,
});

const waitForMail = async () => {
	for (let i = 0; i < 50 && !sent.length; i++) await new Promise(r => setTimeout(r, 10));
	assert.equal(sent.length, 1, 'one email sent');
	return sent[0];
};

test('the decision accepts only reasons from the catalog', () => {
	const parse = body => schemas.respuestaSchema.safeParse({ emailUsuario: 'x@example.test', ...body });
	assert.equal(parse({ estado: 'revision', motivosRevision: ['informe-ilegible'] }).success, true);
	assert.equal(parse({ estado: 'revision', motivosRevision: ['no-existe'] }).success, false);
	assert.equal(parse({ estado: 'revision', motivosRevision: '<b>informe-ilegible</b>' }).success, false);
	assert.deepEqual(parse({ estado: 'revision', motivosRevision: ['informe-ilegible', 'informe-ilegible'] }).data.motivosRevision, ['informe-ilegible']);
	assert.equal(MOTIVOS.every(m => ['datos', 'residencia', 'diagnostico', 'documentos'].includes(m.grupo)), true);
});

test('returning for revision needs at least one reason or a note', () => {
	const parse = body => schemas.respuestaSchema.safeParse({ emailUsuario: 'x@example.test', ...body });
	const empty = parse({ estado: 'revision' });
	assert.equal(empty.success, false);
	assert.equal(empty.error.issues[0].path.join('.'), 'motivosRevision');
	assert.equal(parse({ estado: 'revision', mensajeMedico: '   ' }).success, false);
	assert.equal(parse({ estado: 'revision', mensajeMedico: 'Sube el informe completo' }).success, true);
	assert.equal(parse({ estado: 'rechazado' }).success, true);
});

test('a revision decision stores the reasons and the note and empties the changed groups', async () => {
	reset(user({ estado: 'pendiente', motivosRevision: [], cambiosDesdeRevision: ['datos'] }));
	const res = await call('POST', '/admin/respuesta', {
		as: 'admin',
		body: { emailUsuario: `${A}@example.test`, estado: 'revision', motivosRevision: ['informe-ilegible', 'fecha-nacimiento'], mensajeMedico: 'Gracias' },
	});
	assert.equal(res.status, 200);
	assert.equal(rows[0].estado, 'revision');
	assert.deepEqual(rows[0].motivosRevision, ['informe-ilegible', 'fecha-nacimiento']);
	assert.equal(rows[0].mensajeMedico, 'Gracias');
	assert.deepEqual(rows[0].cambiosDesdeRevision, []);
	await waitForMail();
});

test('the decision route answers 400 for a revision without reasons or note', async () => {
	reset(user({ estado: 'pendiente', motivosRevision: [] }));
	const res = await call('POST', '/admin/respuesta', { as: 'admin', body: { emailUsuario: `${A}@example.test`, estado: 'revision' } });
	assert.equal(res.status, 400);
	assert.equal(rows[0].estado, 'pendiente');
});

test('any other decision empties the reasons and the changed groups', async () => {
	reset(user({ estado: 'pendiente', cambiosDesdeRevision: ['documentos'] }));
	const res = await call('POST', '/admin/respuesta', { as: 'admin', body: { emailUsuario: `${A}@example.test`, estado: 'rechazado' } });
	assert.equal(res.status, 200);
	assert.deepEqual(rows[0].motivosRevision, []);
	assert.deepEqual(rows[0].cambiosDesdeRevision, []);
	await waitForMail();
});

test('the revision email lists the reason titles and none of the person\'s data', async () => {
	reset(user({ estado: 'pendiente', motivosRevision: [] }));
	await call('POST', '/admin/respuesta', {
		as: 'admin',
		body: { emailUsuario: `${A}@example.test`, estado: 'revision', motivosRevision: ['informe-ilegible', 'numero-documento'] },
	});
	const mail = await waitForMail();
	assert.equal(mail.to, `${A}@example.test`);
	for (const body of [mail.html, mail.text]) {
		assert.match(body, /Sube otra foto del informe/);
		assert.match(body, /Revisa el número de documento/);
		assert.doesNotMatch(body, /El informe no se lee bien/);
		assert.match(body, /2 cosas/);
		for (const personal of ['Prueba', 'Sintética', 'SINT-0001', 'Ciudad Ficticia', A]) assert.equal(body.includes(personal), false, personal);
	}
	assert.doesNotMatch(mail.html, /text-transform:uppercase/);
});

test('the revision email HTML-escapes reason titles and the note', async () => {
	const motivo = motivoById('informe-ilegible');
	const titulo = motivo.titulo;
	motivo.titulo = '<b>Título</b> & "más"';
	try {
		reset();
		await sendEmailAdmin('x@example.test', 'revision', '<script>x</script>', ['informe-ilegible']);
		const { html } = sent[0];
		assert.match(html, /&lt;b&gt;Título&lt;\/b&gt; &amp; &quot;más&quot;/);
		assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
		assert.doesNotMatch(html, /<b>Título/);
	} finally {
		motivo.titulo = titulo;
	}
});

test('an "Otro" reason needs its own text, at most 140 characters', () => {
	const parse = body => schemas.respuestaSchema.safeParse({ emailUsuario: 'x@example.test', ...body });
	const ids = ['otro-datos', 'otro-residencia', 'otro-diagnostico', 'otro-documentos'];
	for (const id of ids) {
		assert.equal(motivoById(id).otro, true, id);
		const bare = parse({ estado: 'revision', motivosRevision: [id], mensajeMedico: 'Gracias' });
		assert.equal(bare.success, false, id);
		assert.equal(bare.error.issues[0].path.join('.'), `textosOtro.${id}`);
		assert.equal(parse({ estado: 'revision', motivosRevision: [id], textosOtro: { [id]: '   ' } }).success, false, id);
		assert.equal(parse({ estado: 'revision', motivosRevision: [id], textosOtro: { [id]: 'x'.repeat(141) } }).success, false, id);
		const ok = parse({ estado: 'revision', motivosRevision: [id], textosOtro: { [id]: 'x'.repeat(140) } });
		assert.equal(ok.success, true, id);
		assert.deepEqual(ok.data.textosOtro, { [id]: 'x'.repeat(140) });
	}
	// Only "Otro" ids are keys; texts of reasons not picked are dropped.
	assert.equal(parse({ estado: 'revision', motivosRevision: ['informe-ilegible'], textosOtro: { 'informe-ilegible': 'x' } }).success, false);
	const dropped = parse({ estado: 'revision', motivosRevision: ['otro-datos'], textosOtro: { 'otro-datos': 'Uno', 'otro-documentos': 'Dos' } });
	assert.deepEqual(dropped.data.textosOtro, { 'otro-datos': 'Uno' });
	assert.deepEqual(parse({ estado: 'rechazado', textosOtro: { 'otro-datos': 'Uno' } }).data.textosOtro, {});
	// Each "Otro" is listed last in its group and has no fixed title.
	for (const id of ids) {
		const grupo = MOTIVOS.filter(m => m.grupo === motivoById(id).grupo);
		assert.equal(grupo[grupo.length - 1].id, id);
		assert.equal(motivoById(id).titulo, undefined);
	}
});

test('every fixed reason has an admin title, an applicant title and a tip', () => {
	for (const m of MOTIVOS.filter(r => !r.otro)) {
		assert.ok(m.admin && m.titulo && m.consejo, m.id);
		assert.equal('accion' in m, false, m.id);
	}
});

test('a revision decision stores the "Otro" texts and the next decision empties them', async () => {
	reset(user({ estado: 'pendiente', motivosRevision: [] }));
	await call('POST', '/admin/respuesta', {
		as: 'admin',
		body: { emailUsuario: `${A}@example.test`, estado: 'revision', motivosRevision: ['otro-documentos'], textosOtro: { 'otro-documentos': 'Sube la otra cara' } },
	});
	assert.deepEqual(rows[0].textosOtro, { 'otro-documentos': 'Sube la otra cara' });
	await waitForMail();
	sent.length = 0;

	const next = await call('POST', '/admin/respuesta', { as: 'admin', body: { emailUsuario: `${A}@example.test`, estado: 'rechazado' } });
	assert.equal(next.status, 200);
	assert.deepEqual(rows[0].textosOtro, {});
	await waitForMail();
});

test('the revision email lists an "Otro" reason by its text, escaped', async () => {
	reset(user({ estado: 'pendiente', motivosRevision: [] }));
	await call('POST', '/admin/respuesta', {
		as: 'admin',
		body: { emailUsuario: `${A}@example.test`, estado: 'revision', motivosRevision: ['otro-documentos'], textosOtro: { 'otro-documentos': 'Sube la <b>otra</b> cara' } },
	});
	const mail = await waitForMail();
	assert.match(mail.html, /Sube la &lt;b&gt;otra&lt;\/b&gt; cara/);
	assert.match(mail.text, /Sube la <b>otra<\/b> cara/);
	for (const body of [mail.html, mail.text]) {
		assert.doesNotMatch(body, /Otro cambio en Documentos/);
		assert.match(body, /1 cosa/);
		for (const personal of ['Prueba', 'Sintética', 'SINT-0001', 'Ciudad Ficticia', A]) assert.equal(body.includes(personal), false, personal);
	}
});

test('saving one step during a revision records its group and keeps the application in revision', async () => {
	reset(user());
	const res = await call('PUT', '/inscripcion/actualizar', { as: 'user', body: actualizar({ numeroDocumento: 'SINT-0002', enviar: false }) });
	assert.equal(res.status, 200);
	assert.equal(rows[0].estado, 'revision');
	assert.equal(rows[0].numeroDocumento, 'SINT-0002');
	assert.deepEqual(rows[0].cambiosDesdeRevision, ['residencia']);

	await call('PUT', '/inscripcion/actualizar', {
		as: 'user',
		body: actualizar({ numeroDocumento: 'SINT-0002', diagnostico: { dislexia: true, discalculia: true, disortografía: false, dispraxia: false, tdah: false }, enviar: false }),
	});
	assert.deepEqual(rows[0].cambiosDesdeRevision, ['residencia', 'diagnostico']);
});

test('saving without changes records no group', async () => {
	reset(user());
	await call('PUT', '/inscripcion/actualizar', { as: 'user', body: actualizar({ enviar: false }) });
	assert.deepEqual(rows[0].cambiosDesdeRevision, []);
	assert.equal(rows[0].estado, 'revision');
});

test('the full edit form still sends the application back to review', async () => {
	reset(user());
	await call('PUT', '/inscripcion/actualizar', { as: 'user', body: actualizar({ nombre: 'Otra' }) });
	assert.equal(rows[0].estado, 'pendiente');
	assert.deepEqual(rows[0].cambiosDesdeRevision, ['datos']);
});

test('uploading documents records the documentos group', async () => {
	reset(user({ cambiosDesdeRevision: ['datos'] }));
	const form = new FormData();
	form.append('Diagnostico Medico - Archivo N0', new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }), 'informe.pdf');
	const res = await call('POST', '/inscripcion/subir-archivos', { as: 'user', form });
	assert.equal(res.status, 200);
	assert.equal(uploaded.length, 1);
	assert.equal(rows[0].estado, 'revision');
	assert.deepEqual(rows[0].cambiosDesdeRevision, ['datos', 'documentos']);
});

test('changes outside a revision are not recorded', async () => {
	reset(user({ estado: 'borrador', motivosRevision: [] }));
	const form = new FormData();
	form.append('Diagnostico Medico - Archivo N0', new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }), 'informe.pdf');
	assert.equal((await call('POST', '/inscripcion/subir-archivos', { as: 'user', form })).status, 200);
	assert.deepEqual(rows[0].cambiosDesdeRevision, []);

	reset(user({ estado: 'pendiente', motivosRevision: [] }));
	await call('PUT', '/inscripcion/actualizar', { as: 'user', body: actualizar({ nombre: 'Otra' }) });
	assert.equal(rows[0].nombre, 'Otra');
	assert.deepEqual(rows[0].cambiosDesdeRevision, []);
});

test('reenviar sends a revised application back to review, only from revision', async () => {
	reset(user({ cambiosDesdeRevision: ['documentos'] }));
	const res = await call('POST', '/inscripcion/reenviar', { as: 'user' });
	assert.equal(res.status, 200);
	assert.equal(rows[0].estado, 'pendiente');
	assert.deepEqual(rows[0].cambiosDesdeRevision, ['documentos']);
	assert.equal(res.data.usuario.estado, 'pendiente');

	assert.equal((await call('POST', '/inscripcion/reenviar', { as: 'user' })).status, 409);
});

test('the applicant and the admin see the reasons and the changed groups', async () => {
	reset(user({ cambiosDesdeRevision: ['residencia'], textosOtro: { 'otro-datos': 'Añade el segundo apellido' } }));
	const me = await call('GET', '/usuario/me', { as: 'user' });
	assert.deepEqual(me.data.textosOtro, { 'otro-datos': 'Añade el segundo apellido' });
	assert.deepEqual(me.data.motivosRevision, ['informe-ilegible', 'numero-documento']);
	assert.deepEqual(me.data.cambiosDesdeRevision, ['residencia']);

	const detail = await call('POST', `/admin/solicitudes/${A}`, { as: 'admin' });
	assert.deepEqual(detail.data.usuario.motivosRevision, ['informe-ilegible', 'numero-documento']);
	assert.deepEqual(detail.data.usuario.textosOtro, { 'otro-datos': 'Añade el segundo apellido' });
	assert.deepEqual(detail.data.usuario.cambiosDesdeRevision, ['residencia']);
});
