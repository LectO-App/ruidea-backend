const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Route tests against an in-memory stand-in for the Prisma client (no database needed).
// The fake implements only the calls these routes make. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const rows = [];
let counter = null;
let raceOnUpdate = false;

const matches = (row, where) =>
	Object.entries(where).every(([k, v]) => {
		if (v && typeof v === 'object') {
			if ('not' in v) return row[k] !== v.not;
			if ('gte' in v) return row[k] >= v.gte;
			return false;
		}
		return row[k] === v;
	});

const uniqueViolation = target => Object.assign(new Error('unique'), { code: 'P2002', meta: { target } });

const fake = {
	usuario: {
		findUnique: async ({ where }) => rows.find(r => matches(r, where)) || null,
		findFirst: async ({ where, orderBy }) => {
			const found = rows.filter(r => matches(r, where));
			if (orderBy && orderBy.numeroPasaporte === 'desc') found.sort((a, b) => b.numeroPasaporte - a.numeroPasaporte);
			return found[0] || null;
		},
		update: async ({ where, data }) => {
			const row = rows.find(r => matches(r, where));
			if (!row) throw Object.assign(new Error('missing'), { code: 'P2025' });
			if (raceOnUpdate) throw uniqueViolation(['numeroPasaporte']);
			if (data.numeroPasaporte >= 1000 && rows.some(o => o !== row && o.numeroPasaporte === data.numeroPasaporte)) {
				throw uniqueViolation(['numeroPasaporte']);
			}
			Object.assign(row, data);
			return row;
		},
	},
	counter: {
		createMany: async ({ data }) => {
			if (counter == null) counter = data[0].seq;
		},
	},
	auditLog: { create: async () => ({}) },
	$queryRaw: async () => (counter == null ? [] : [{ seq: ++counter }]),
};

// Must happen before any module that destructures getPrisma is loaded.
require('../db/prisma').getPrisma = () => fake;

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');
const { nextPassporte } = require('../functions/passport');

const user = (id, overrides = {}) => ({
	id,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	paisResidencia: 'España',
	localidadResidencia: 'Ciudad Ficticia',
	lugarNacimiento: 'Pueblo Ficticio',
	tipoDocumento: null,
	numeroDocumento: '00000000T',
	fechaNacimiento: new Date('2010-01-01T00:00:00Z'),
	correoElectronico: `${id}@example.test`,
	numeroTelefono: '+34600000000',
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

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';

let server;
let base;
const csrf = 'test-csrf';
const adminCookie = `token=${signToken({ id: 'admin', role: 'admin', csrf }, { expiresIn: '1h' })}`;

const post = (path, body, { admin = false } = {}) =>
	fetch(base + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(admin ? { cookie: adminCookie, 'x-csrf-token': csrf } : {}) },
		body: JSON.stringify(body),
	});

before(async () => {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use('/admin', require('../routes/admin'));
	app.use('/usuario', require('../routes/usuario'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

const reset = list => {
	rows.splice(0, rows.length, ...list);
	counter = null;
	raceOnUpdate = false;
};

test('nextPassporte skips numbers someone already holds and advances the counter past them', async () => {
	reset([user(A, { numeroPasaporte: 1001 }), user(B, { numeroPasaporte: 1002 }), user(C, { numeroPasaporte: 1004 })]);
	counter = 1000;
	assert.equal(await nextPassporte(), 1003);
	assert.equal(await nextPassporte(), 1005);
	assert.equal(counter, 1005);
});

test('nextPassporte seeds from the highest issued number when there is no counter yet', async () => {
	reset([user(A, { numeroPasaporte: 1007 })]);
	assert.equal(await nextPassporte(), 1008);
});

test('admin modify with a passport number held by someone else answers 409, not 500', async () => {
	reset([user(A, { numeroPasaporte: 1001, estado: 'aceptado' }), user(B)]);
	const res = await post(
		'/admin/modificarSolicitud',
		{
			id: B,
			nombre: 'Prueba',
			apellidos: 'Sintética',
			paisResidencia: 'España',
			localidadResidencia: 'Ciudad Ficticia',
			lugarNacimiento: 'Pueblo Ficticio',
			numeroDocumento: '00000000T',
			fechaNacimiento: '2010-01-01',
			correoElectronico: `${B}@example.test`,
			numeroTelefono: '+34600000000',
			numeroPasaporte: 1001,
		},
		{ admin: true }
	);
	assert.equal(res.status, 409);
	assert.match((await res.json()).message, /ya está asignado/);
	assert.equal(rows[1].numeroPasaporte, -1);
});

test('accepting someone answers 409 when the allocated number is taken concurrently', async () => {
	reset([user(A)]);
	counter = 1000;
	raceOnUpdate = true;
	const res = await post('/admin/respuesta', { emailUsuario: `${A}@example.test`, estado: 'aceptado' }, { admin: true });
	assert.equal(res.status, 409);
	assert.match((await res.json()).message, /número de pasaporte/);
});
