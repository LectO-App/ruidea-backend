const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// "Mis datos": holders see, download and delete their own data (GET /usuario/me/datos,
// PATCH /usuario/me/comunicaciones, GET /usuario/me/export, DELETE /usuario/me). Prisma,
// nodemailer, Azure storage and the headless browser are in-memory fakes. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.FRONTEND_URL = 'http://front.example.test';

const rows = [];
const audits = [];
const sent = [];
const blobs = new Map();
const blobWrites = [];
const rendered = [];

const matches = (row, where) =>
	Object.entries(where).every(([k, v]) => {
		if (v && typeof v === 'object' && !(v instanceof Date)) {
			if ('in' in v) return v.in.includes(row[k]);
			if ('gte' in v) return row[k] >= v.gte;
			if ('not' in v) return row[k] !== v.not;
			return false;
		}
		return row[k] === v;
	});

const fake = {
	usuario: {
		findUnique: async ({ where, select }) => {
			const row = rows.find(r => matches(r, where)) || null;
			return row && select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row;
		},
		findFirst: async ({ where }) => rows.find(r => matches(r, where)) || null,
		update: async ({ where, data }) => {
			const row = rows.find(r => matches(r, where));
			if (!row) throw Object.assign(new Error('missing'), { code: 'P2025' });
			return Object.assign(row, data);
		},
		delete: async ({ where }) => {
			const i = rows.findIndex(r => matches(r, where));
			if (i < 0) throw Object.assign(new Error('missing'), { code: 'P2025' });
			return rows.splice(i, 1)[0];
		},
	},
	auditLog: {
		create: async ({ data }) => audits.push({ at: new Date(), ...data }),
		findMany: async ({ where, select }) =>
			audits
				.filter(a => matches(a, where))
				.sort((a, b) => a.at - b.at)
				.map(a => Object.fromEntries(Object.keys(select).map(k => [k, a[k]]))),
	},
};
require('../db/prisma').getPrisma = () => fake;
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });
require('azure-storage').createBlobService = () => ({
	listBlobsSegmentedWithPrefix(container, prefix, token, cb) {
		cb(null, { entries: [...blobs.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name })), continuationToken: null });
	},
	getBlobToStream(container, name, sink, cb) {
		sink.end(blobs.get(name), () => cb(null));
	},
	deleteBlobIfExists(container, name, options, cb) {
		cb(null, blobs.delete(name));
	},
	createBlockBlobFromStream(container, name) {
		blobWrites.push(name);
	},
});
require('../functions/browser').withPage = async fn =>
	fn({
		setContent: async html => rendered.push(html),
		evaluate: async () => {},
		pdf: async () => Buffer.from('%PDF-fake'),
	});

const express = require('express');
const cookieParser = require('cookie-parser');
const JSZip = require('jszip');
const { signToken } = require('../functions/tokens');
const { PUBLIC_FIELDS } = require('../functions/publicView');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN = 'T'.repeat(43);

const holder = (id, overrides = {}) => ({
	id,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	paisResidencia: 'España',
	localidadResidencia: 'Ciudad Ficticia',
	lugarNacimiento: 'Pueblo Ficticio',
	tipoDocumento: 'dni',
	numeroDocumento: '00000000T',
	fechaNacimiento: new Date('2010-01-01T00:00:00Z'),
	correoElectronico: `${id}@example.test`,
	numeroTelefono: '+34600000000',
	dislexia: true,
	discalculia: false,
	disortografia: false,
	dispraxia: false,
	tdah: true,
	esTutor: false,
	tutorNombre: '',
	tutorApellidos: '',
	tutorParentesco: '',
	password: 'not-a-real-hash',
	emailVerificado: true,
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	estado: 'aceptado',
	mensajeMedico: '',
	numeroPasaporte: 1001,
	aceptoRecibirInfo: true,
	aceptoSolicitud: true,
	fechaConsentimiento: new Date('2026-01-01T00:00:00Z'),
	fechaEnvio: new Date('2026-01-02T00:00:00Z'),
	archivoBlob: `${id}/2026-01-02T00:00:00.000Z.pdf`,
	extra: null,
	tokenVersion: 0,
	shareToken: TOKEN,
	...overrides,
});

const csrf = 'test-csrf';
const cookieFor = (id, role) => `token=${signToken({ id, role, csrf, ...(role === 'user' ? { tv: 0 } : {}) }, { expiresIn: '1h' })}`;
const USER = cookieFor(A, 'user');
const ADMIN = cookieFor('admin', 'admin');

let server;
let base;
const call = (method, path, { body, cookie = USER, csrfHeader = csrf } = {}) =>
	fetch(base + path, {
		method,
		headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfHeader },
		body: body && JSON.stringify(body),
	});

// The email and audit writes are fire-and-forget: wait for them to land.
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const daysAgo = (n, hour = 10) => {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - n);
	d.setUTCHours(hour, 0, 0, 0);
	return d;
};
const day = d => d.toISOString().slice(0, 10);

before(async () => {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use('/usuario', require('../routes/usuario'));
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
	blobWrites.length = 0;
	rendered.length = 0;
});

test('every Mis datos route answers 401 without a session and 404 to an admin session', async () => {
	rows.push(holder(A));
	const routes = [
		['GET', '/usuario/me/datos'],
		['PATCH', '/usuario/me/comunicaciones', { aceptoRecibirInfo: false }],
		['GET', '/usuario/me/export'],
		['DELETE', '/usuario/me'],
	];
	for (const [method, path, body] of routes) {
		assert.equal((await call(method, path, { body, cookie: '' })).status, 401, `${method} ${path} without session`);
		assert.equal((await call(method, path, { body, cookie: ADMIN })).status, 404, `${method} ${path} as admin`);
	}
	await settle();
	assert.equal(rows.length, 1);
	assert.equal(rows[0].aceptoRecibirInfo, true);
	assert.equal(audits.length, 0);
});

test('a holder only ever gets their own data, whatever the session of another holder', async () => {
	rows.push(holder(A), holder(B, { nombre: 'Otra', numeroPasaporte: 1002 }));
	const res = await call('GET', '/usuario/me/datos', { cookie: cookieFor(B, 'user') });
	assert.equal(res.status, 200);
	const body = await res.json();
	const nombre = body.grupos.find(g => g.clave === 'persona').campos.find(c => c.clave === 'nombre');
	assert.equal(nombre.valor, 'Otra');
});

test('the field list marks exactly the public passport page fields as "en tu enlace"', async () => {
	rows.push(holder(A));
	const res = await call('GET', '/usuario/me/datos');
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.equal(body.estado, 'aceptado');
	assert.equal(body.aceptoRecibirInfo, true);

	const fields = vis => body.grupos.filter(g => g.visibilidad === vis).flatMap(g => g.campos.map(c => c.clave));
	assert.deepStrictEqual(new Set(fields('enlace')), new Set(PUBLIC_FIELDS));
	assert.ok(fields('equipo').length > 0);
	assert.ok(fields('equipo').every(f => !PUBLIC_FIELDS.includes(f)));
	for (const f of ['correoElectronico', 'numeroTelefono', 'tutorNombre', 'archivoBlob']) assert.ok(fields('equipo').includes(f), f);

	const valor = clave => body.grupos.flatMap(g => g.campos).find(c => c.clave === clave).valor;
	assert.equal(valor('diagnostico'), 'Dislexia, TDAH');
	assert.equal(valor('fechaNacimiento'), '01/01/2010');
	assert.equal(valor('numeroPasaporte'), '0001001');
	assert.equal(valor('archivoBlob'), 'Sí, están guardados', 'the storage name never reaches the page');
	assert.doesNotMatch(JSON.stringify(body), /not-a-real-hash|TTTTTTTT/, 'no password hash or share token');
});

test('link openings are the last 30 days of successful verifications, as days, with no IPs or verifiers', async () => {
	rows.push(holder(A));
	const target = '1001';
	const meta = { country: 'ES', device: 'mobile' };
	audits.push(
		{ action: 'passport.verify_token', outcome: 'success', target, at: daysAgo(1), ip: '203.0.113.9', meta },
		{ action: 'passport.verify_token', outcome: 'success', target, at: daysAgo(1, 12), ip: '203.0.113.9', meta },
		{ action: 'passport.lookup', outcome: 'success', target, at: daysAgo(3), actorType: 'verifier', actorId: 'verifier-id-1', ip: null },
		// The page the verifier check opened a minute later: the same opening.
		{ action: 'passport.verify_token', outcome: 'success', target, at: new Date(daysAgo(3).getTime() + 60000), ip: null },
		{ action: 'passport.verify_link', outcome: 'success', target, at: daysAgo(5) },
		{ action: 'passport.verify_token', outcome: 'not_found', target, at: daysAgo(2) },
		{ action: 'passport.lookup', outcome: 'document_mismatch', target, at: daysAgo(2) },
		{ action: 'passport.verify_token', outcome: 'success', target: '1002', at: daysAgo(2) },
		{ action: 'passport.verify_token', outcome: 'success', target, at: daysAgo(31) },
		{ action: 'passport.download', outcome: 'success', target, at: daysAgo(1) }
	);
	const res = await call('GET', '/usuario/me/datos');
	const { enlace } = await res.json();
	assert.deepStrictEqual(enlace, { veces: 4, dias: [day(daysAgo(1)), day(daysAgo(3)), day(daysAgo(5))] });

	const raw = JSON.stringify(enlace);
	assert.doesNotMatch(raw, /203\.0\.113|verifier|ES|mobile|T\d\d:/, 'days only: no IP, verifier, place, device or time');
});

test('there is no link section before a passport is issued', async () => {
	rows.push(holder(A, { estado: 'pendiente', numeroPasaporte: -1 }));
	const body = await (await call('GET', '/usuario/me/datos')).json();
	assert.equal(body.enlace, null);
	assert.equal(body.estado, 'pendiente');
});

test('the newsletter switch changes only aceptoRecibirInfo, never estado, and is audited', async () => {
	rows.push(holder(A, { estado: 'aceptado' }));
	const before = { ...rows[0] };
	const res = await call('PATCH', '/usuario/me/comunicaciones', { body: { aceptoRecibirInfo: false } });
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await res.json(), { aceptoRecibirInfo: false });
	assert.deepStrictEqual(rows[0], { ...before, aceptoRecibirInfo: false });
	await settle();
	assert.deepStrictEqual(
		audits.map(a => [a.action, a.actorType, a.actorId, a.target, a.outcome, a.meta]),
		[['user.comunicaciones', 'user', A, A, 'success', { aceptoRecibirInfo: false }]]
	);

	assert.equal((await call('PATCH', '/usuario/me/comunicaciones', { body: { aceptoRecibirInfo: true } })).status, 200);
	assert.equal(rows[0].aceptoRecibirInfo, true);
	assert.equal(rows[0].estado, 'aceptado');
});

test('the newsletter switch rejects other fields, non-booleans and a missing CSRF header', async () => {
	rows.push(holder(A));
	for (const body of [{ aceptoRecibirInfo: 'no' }, { aceptoRecibirInfo: false, estado: 'pendiente' }, {}]) {
		assert.equal((await call('PATCH', '/usuario/me/comunicaciones', { body })).status, 400, JSON.stringify(body));
	}
	assert.equal((await call('PATCH', '/usuario/me/comunicaciones', { body: { aceptoRecibirInfo: false }, csrfHeader: '' })).status, 403);
	assert.equal(rows[0].aceptoRecibirInfo, true);
	assert.equal(rows[0].estado, 'aceptado');
});

test('the export is a ZIP with the readable PDF, datos.json and every upload, and nothing is stored', async () => {
	rows.push(holder(A, { nombre: '<b>Ana</b>' }));
	blobs.set(`${A}/2026-01-01T00:00:00.000Z.zip`, Buffer.from('old-zip'));
	blobs.set(`${A}/2026-01-02T00:00:00.000Z.pdf`, Buffer.from('%PDF-informe'));
	blobs.set(`${B}/2026-01-01T00:00:00.000Z.pdf`, Buffer.from('someone-else'));

	const res = await call('GET', '/usuario/me/export');
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'application/zip');
	assert.equal(res.headers.get('content-disposition'), 'attachment; filename="mis-datos-ruidea.zip"');
	assert.equal(res.headers.get('cache-control'), 'no-store');

	const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
	assert.deepStrictEqual(Object.keys(zip.files).filter(n => !zip.files[n].dir).sort(), [
		'datos.json',
		'documentos/documento-1.zip',
		'documentos/documento-2.pdf',
		'mis-datos.pdf',
	]);
	assert.equal(await zip.file('mis-datos.pdf').async('string'), '%PDF-fake');
	assert.equal(await zip.file('documentos/documento-2.pdf').async('string'), '%PDF-informe');
	const datos = JSON.parse(await zip.file('datos.json').async('string'));
	assert.equal(datos.usuario._id, A);
	assert.equal(datos.usuario.password, undefined);
	assert.deepStrictEqual(datos.enlace, { veces: 0, dias: [] });

	assert.equal(rendered.length, 1);
	assert.match(rendered[0], /Mis datos en RUIDEA/);
	assert.match(rendered[0], /en tu enlace/);
	assert.match(rendered[0], /Dislexia, TDAH/);
	assert.ok(!rendered[0].includes('<b>Ana</b>'), 'the PDF HTML is escaped');

	assert.deepStrictEqual(blobWrites, [], 'the export is never uploaded');
	assert.equal(blobs.size, 3);
	await settle();
	assert.deepStrictEqual(
		audits.map(a => [a.action, a.actorType, a.actorId, a.target, a.outcome, a.meta]),
		[['user.export', 'user', A, A, 'success', undefined]]
	);
});

test('the export fails with a 500 when a document cannot be read, instead of a copy without it', async () => {
	rows.push(holder(A));
	const service = require('azure-storage').createBlobService;
	require('azure-storage').createBlobService = () => ({
		...service(),
		getBlobToStream(container, name, sink, cb) {
			cb(Object.assign(new Error('storage down'), { code: 'ServiceUnavailable' }));
		},
	});
	blobs.set(`${A}/2026-01-02T00:00:00.000Z.pdf`, Buffer.from('x'));
	try {
		const res = await call('GET', '/usuario/me/export');
		assert.equal(res.status, 500);
		assert.match((await res.json()).message, /No pudimos preparar tu copia/);
	} finally {
		require('azure-storage').createBlobService = service;
	}
	await settle();
	assert.equal(audits.length, 0);
});

test('deleting the account removes the row and every upload, ends the session, emails and audits the id only', async () => {
	rows.push(holder(A, { nombre: '<b>Ana</b>' }), holder(B, { numeroPasaporte: 1002, shareToken: 'U'.repeat(43) }));
	blobs.set(`${A}/2026-01-01T00:00:00.000Z.zip`, Buffer.from('old'));
	blobs.set(`${A}/2026-01-02T00:00:00.000Z.pdf`, Buffer.from('new'));
	blobs.set(`${B}/2026-01-01T00:00:00.000Z.pdf`, Buffer.from('other'));

	const res = await call('DELETE', '/usuario/me');
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await res.json(), { ok: true });
	assert.match(res.headers.get('set-cookie'), /token=;/);
	await settle();

	assert.deepStrictEqual(rows.map(r => r.id), [B]);
	assert.deepStrictEqual([...blobs.keys()], [`${B}/2026-01-01T00:00:00.000Z.pdf`]);
	assert.deepStrictEqual(
		audits.map(a => [a.action, a.actorType, a.actorId, a.target, a.outcome, a.meta]),
		[['user.delete_self', 'user', A, A, 'success', undefined]]
	);

	assert.equal(sent.length, 1);
	assert.equal(sent[0].to, `${A}@example.test`);
	assert.match(sent[0].subject, /Hemos borrado tu cuenta/);
	assert.match(sent[0].html, /ya no funciona/);
	assert.ok(!sent[0].html.includes('<b>Ana</b>'), 'the name is HTML-escaped');

	assert.equal((await call('GET', '/usuario/me')).status, 401, 'the old session no longer works');
	const byToken = await call('POST', `/usuario/verificar/${TOKEN}`, { cookie: '' });
	assert.deepStrictEqual(await byToken.json(), { existe: false });
	const byNumber = await call('POST', '/usuario/verificar/00000000T/1001', { cookie: '' });
	assert.deepStrictEqual(await byNumber.json(), { existe: false });
});

test('deleting the account needs the CSRF header', async () => {
	rows.push(holder(A));
	assert.equal((await call('DELETE', '/usuario/me', { csrfHeader: '' })).status, 403);
	await settle();
	assert.equal(rows.length, 1);
	assert.equal(sent.length, 0);
});
