const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// Passport verification routes against an in-memory stand-in for the Prisma client (no
// database). All people, keys and passwords are synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.VERIFY_PASSWORD = 'shared-test-password';
process.env.VERIFIER_KEY_HOURLY_LIMIT = '3';

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const usuarios = [
	{ id: 'a'.repeat(24), nombre: 'Prueba', apellidos: 'Uno', numeroDocumento: '40.111.222', numeroPasaporte: 1001, estado: 'aceptado' },
	{ id: 'b'.repeat(24), nombre: 'Prueba', apellidos: 'Dos', numeroDocumento: '12345678Z', numeroPasaporte: 1002, estado: 'aceptado' },
	{ id: 'c'.repeat(24), nombre: 'Prueba', apellidos: 'Tres', numeroDocumento: '40.333.444', numeroPasaporte: 1003, estado: 'pendiente' },
].map(u => ({ correoElectronico: `${u.id}@example.test`, password: 'x', dislexia: true, fechaNacimiento: new Date('2012-05-01'), ...u }));
const verifiers = [
	{ id: 'v1', nombre: 'Verificador 1', keyHash: sha('key-one'), activo: true },
	{ id: 'v2', nombre: 'Verificador 2', keyHash: sha('key-two'), activo: true },
];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const fake = {
	usuario: { findFirst: async ({ where }) => usuarios.find(r => matches(r, where)) || null },
	verifier: {
		findFirst: async ({ where }) => verifiers.find(r => matches(r, where)) || null,
		update: async () => ({}),
	},
	auditLog: { create: async () => ({}) },
};
require('../db/prisma').getPrisma = () => fake;

const express = require('express');
let server;
let base;
before(async () => {
	const app = express();
	app.use(express.json());
	app.use('/usuario', require('../routes/usuario'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const post = async (path, body, headers = {}) => {
	const res = await fetch(base + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: res.status, body: await res.json() };
};
const check = (body, headers) => post('/usuario/verificarCheckPassword', body, headers);

test('a passport number alone no longer returns a document number', async () => {
	for (const cred of [{ body: { password: 'shared-test-password' } }, { headers: { 'x-verifier-key': 'key-one' } }]) {
		const r = await check({ pasaporte: 1001, ...cred.body }, cred.headers);
		assert.equal(r.status, 400);
		assert.equal(r.body.correcto, false);
		assert.equal(JSON.stringify(r.body).includes('40.111.222'), false);
		assert.equal('documento' in r.body, false);
	}
});

test('passport + matching document + credential answers yes, with no record fields', async () => {
	const shared = await check({ pasaporte: 1001, documento: '40.111.222', password: 'shared-test-password' });
	assert.deepEqual(shared, { status: 200, body: { correcto: true, existe: true } });
	const key = await check({ pasaporte: 1002, documento: '12345678Z' }, { 'x-verifier-key': 'key-one' });
	assert.deepEqual(key, { status: 200, body: { correcto: true, existe: true } });
});

test('the document matches regardless of case, spaces, dots and dashes', async () => {
	for (const [pasaporte, documento] of [[1001, '40111222'], [1001, ' 40-111-222 '], [1002, '12345678z']]) {
		const r = await check({ pasaporte, documento, password: 'shared-test-password' });
		assert.equal(r.status, 200, documento);
	}
});

test('wrong document, wrong credential, unknown or pending passport all get the same 401', async () => {
	const denied = { status: 401, body: { correcto: false } };
	const pw = 'shared-test-password';
	assert.deepEqual(await check({ pasaporte: 1001, documento: '40.999.999', password: pw }), denied);
	assert.deepEqual(await check({ pasaporte: 1001, documento: '12345678Z', password: pw }), denied);
	assert.deepEqual(await check({ pasaporte: 1001, documento: '40.111.222', password: 'wrong' }), denied);
	assert.deepEqual(await check({ pasaporte: 1001, documento: '40.111.222' }), denied);
	assert.deepEqual(await check({ pasaporte: 1001, documento: '40.111.222' }, { 'x-verifier-key': 'nope' }), denied);
	assert.deepEqual(await check({ pasaporte: 1003, documento: '40.333.444', password: pw }), denied);
	assert.deepEqual(await check({ pasaporte: 1999, documento: '40.111.222', password: pw }), denied);
});

test('the public share link accepts the document in any of those formats, and only the right one', async () => {
	const ok = await post('/usuario/verificar/40111222/1001');
	assert.equal(ok.body.existe, true);
	assert.equal(ok.body.usuario.nombre, 'Prueba');
	assert.equal((await post('/usuario/verificar/40.111.222/1001')).body.existe, true);
	assert.deepEqual((await post('/usuario/verificar/40.999.999/1001')).body, { existe: false });
	assert.deepEqual((await post('/usuario/verificar/40.333.444/1003')).body, { existe: false });
});

test('a verifier key has an hourly quota; other keys and the shared password are not affected', async () => {
	const body = { pasaporte: 1001, documento: '40.111.222' };
	const statuses = [];
	for (let i = 0; i < 5; i++) statuses.push((await check(body, { 'x-verifier-key': 'key-two' })).status);
	assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
	assert.equal((await check(body, { 'x-verifier-key': 'key-one' })).status, 200);
	assert.equal((await check({ ...body, password: 'shared-test-password' })).status, 200);
});
