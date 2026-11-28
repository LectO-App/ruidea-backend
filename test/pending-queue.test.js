const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// Review queue: pending applications oldest first by fechaEnvio, and GET /admin/siguiente.
// Prisma and nodemailer are in-memory fakes. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const rows = [];
const logs = [];

const matches = (row, where) =>
	Object.entries(where).every(([k, v]) => {
		if (k === 'OR') return v.some(w => matches(row, w));
		if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
		return row[k] === v;
	});

const fake = {
	usuario: {
		findMany: async ({ where }) => rows.filter(r => matches(r, where)),
	},
	auditLog: { create: async () => {}, groupBy: async () => [] },
};
require('../db/prisma').getPrisma = () => fake;
require('nodemailer').createTransport = () => ({ sendMail: async () => {} });

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');
const { oldestFirst } = require('../functions/queue');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';
const D = 'dddddddddddddddddddddddd';

const row = (id, overrides = {}) => ({
	id,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	correoElectronico: `${id}@example.test`,
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
	emailVerificado: true,
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	estado: 'pendiente',
	mensajeMedico: '',
	numeroPasaporte: -1,
	aceptoRecibirInfo: false,
	aceptoSolicitud: true,
	fechaConsentimiento: null,
	fechaEnvio: null,
	archivoBlob: '',
	extra: null,
	...overrides,
});

const csrf = 'test-csrf';
const ADMIN = `token=${signToken({ id: 'admin', role: 'admin', csrf }, { expiresIn: '1h' })}`;
const USER = `token=${signToken({ id: A, role: 'user', csrf }, { expiresIn: '1h' })}`;

let server;
let base;
const call = (method, path, { body, cookie = ADMIN } = {}) =>
	fetch(base + path, {
		method,
		headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
		body: body && JSON.stringify(body),
	});

before(async () => {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use((req, res, next) => {
		const capture = (level) => (obj, msg) => logs.push({ level, obj, msg });
		req.log = { info: capture('info'), warn: capture('warn'), error: capture('error') };
		next();
	});
	app.use('/admin', require('../routes/admin'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

beforeEach(() => {
	rows.length = 0;
	logs.length = 0;
});

// Inserted in an order that is neither the waiting order nor the creation order.
const seed = () =>
	rows.push(
		row(A, { fechaCreacion: new Date('2026-01-01T00:00:00Z'), fechaEnvio: new Date('2026-03-10T00:00:00Z') }),
		row(B, { fechaCreacion: new Date('2026-02-01T00:00:00Z'), fechaEnvio: null }),
		row(C, { fechaCreacion: new Date('2026-01-15T00:00:00Z'), fechaEnvio: new Date('2026-01-20T00:00:00Z') }),
		row(D, { estado: 'aceptado', fechaEnvio: new Date('2025-01-01T00:00:00Z') })
	);

test('oldestFirst sorts by fechaEnvio, falls back to fechaCreacion, and puts records without dates last', () => {
	const list = [
		{ _id: 'x' },
		{ _id: 'a', fechaEnvio: '2026-03-10T00:00:00Z', fechaCreacion: '2026-01-01T00:00:00Z' },
		{ _id: 'b', fechaEnvio: null, fechaCreacion: '2026-02-01T00:00:00Z' },
		{ _id: 'c', fechaEnvio: '2026-01-20T00:00:00Z' },
	];
	assert.deepStrictEqual(oldestFirst(list).map(u => u._id), ['c', 'b', 'a', 'x']);
});

test('the pending list comes oldest first by fechaEnvio and every item has fechaEnvio', async () => {
	seed();
	const res = await call('POST', '/admin/solicitudes', { body: { condicion: 'pendiente' } });
	assert.equal(res.status, 200);
	const list = await res.json();
	assert.deepStrictEqual(list.map(u => u._id), [C, B, A]);
	assert.ok(list.every(u => 'fechaEnvio' in u));
	assert.equal(list[1].fechaEnvio, null);
});

test('siguiente answers the pending application that has waited longest', async () => {
	seed();
	const res = await call('GET', '/admin/siguiente');
	assert.equal(res.status, 200);
	const body = await res.json();
	assert.deepStrictEqual(body, {
		siguiente: { _id: C, fechaEnvio: '2026-01-20T00:00:00.000Z', fechaCreacion: '2026-01-15T00:00:00.000Z' },
		pendientes: 3,
	});
});

test('siguiente leaves out the application just decided', async () => {
	seed();
	const body = await (await call('GET', `/admin/siguiente?excluir=${C}`)).json();
	assert.equal(body.siguiente._id, B);
	assert.equal(body.pendientes, 2);
});

test('siguiente answers null when no pending application is left', async () => {
	rows.push(row(A));
	const body = await (await call('GET', `/admin/siguiente?excluir=${A}`)).json();
	assert.deepStrictEqual(body, { siguiente: null, pendientes: 0 });
});

test('siguiente rejects an excluir that is not an id', async () => {
	const res = await call('GET', '/admin/siguiente?excluir=not-an-id');
	assert.equal(res.status, 400);
});

test('siguiente is for admins only', async () => {
	seed();
	const res = await call('GET', '/admin/siguiente', { cookie: USER });
	assert.ok([401, 403].includes(res.status));
});

test('siguiente logs no personal data when the query fails', async () => {
	const findMany = fake.usuario.findMany;
	fake.usuario.findMany = async () => {
		throw new Error('db down');
	};
	try {
		const res = await call('GET', '/admin/siguiente');
		assert.equal(res.status, 500);
		const logged = JSON.stringify(logs.map(l => ({ msg: l.msg, err: l.obj && l.obj.err && l.obj.err.message })));
		assert.ok(!/example\.test|Prueba|Sintética/.test(logged));
	} finally {
		fake.usuario.findMany = findMany;
	}
});
