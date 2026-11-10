const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Share tokens against a real Postgres with the migrations applied (`prisma migrate deploy`).
// Runs only when TEST_DATABASE_URL points at a disposable test database: it deletes the rows
// it creates and refuses to run if the `usuarios` table holds anything else. Skipped otherwise
// (CI has no database). All people are synthetic.
const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'TEST_DATABASE_URL not set';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
if (url) process.env.DATABASE_URL = url;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
let server;
let base;
let prisma;
let Usuario;
const created = [];

before(async () => {
	if (skip) return;
	prisma = require('../db/prisma').getPrisma();
	if ((await prisma.usuario.count()) !== 0) throw new Error('TEST_DATABASE_URL is not an empty test database');
	Usuario = require('../models/modeloUsuario');
	const express = require('express');
	const cookieParser = require('cookie-parser');
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use('/usuario', require('../routes/usuario'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	if (skip) return;
	if (created.length) await prisma.usuario.deleteMany({ where: { id: { in: created } } });
	await prisma.auditLog.deleteMany({});
	await prisma.$disconnect();
	if (server) server.close();
});

const bcrypt = require('bcrypt');
const holder = async (n, overrides = {}) => {
	const u = await Usuario.create({
		nombre: 'Prueba',
		apellidos: `Sintética ${n}`,
		paisResidencia: 'España',
		numeroDocumento: `0000000${n}T`,
		fechaNacimiento: '2010-01-01T00:00:00Z',
		correoElectronico: `holder${n}@example.test`,
		password: await bcrypt.hash('clave-de-prueba', 4),
		diagnostico: { dislexia: true },
		estado: 'aceptado',
		numeroPasaporte: 1000 + n,
		...overrides,
	});
	created.push(u._id);
	return u;
};

const post = async (path, body, headers = {}) => {
	const res = await fetch(base + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: res.status, body: await res.json(), headers: res.headers };
};

test('every new holder gets a distinct 43-character base64url token from the column default', { skip }, async () => {
	const users = [];
	for (let n = 1; n <= 5; n++) users.push(await holder(n));
	const tokens = users.map(u => u.shareToken);
	for (const t of tokens) assert.match(t, TOKEN_RE);
	assert.equal(new Set(tokens).size, tokens.length);
	// The token is not part of the record's API JSON (admin lists, login, Excel keep their shape).
	for (const u of users) assert.equal('shareToken' in JSON.parse(JSON.stringify(u)), false);
});

test('the unique index rejects a duplicate token', { skip }, async () => {
	const [a, b] = await prisma.usuario.findMany({ orderBy: { orden: 'asc' }, take: 2 });
	await assert.rejects(
		prisma.usuario.update({ where: { id: b.id }, data: { shareToken: a.shareToken } }),
		err => err.code === 'P2002'
	);
	const idx = await prisma.$queryRaw`SELECT indexdef FROM pg_indexes WHERE tablename = 'usuarios' AND indexname = 'usuarios_shareToken_key'`;
	assert.match(idx[0].indexdef, /CREATE UNIQUE INDEX/);
});

test('the token route serves exactly what the number route serves, only for accepted passports', { skip }, async () => {
	const accepted = await Usuario.findByPassportNumber(1001);
	const byToken = await post(`/usuario/verificar/${accepted.shareToken}`);
	const byNumber = await post('/usuario/verificar/00000001T/1001');
	assert.equal(byToken.body.existe, true);
	assert.deepEqual(byToken.body, byNumber.body);
	assert.equal(byToken.body.usuario.numeroPasaporte, 1001);

	const pending = await holder(6, { estado: 'pendiente', numeroPasaporte: -1 });
	assert.deepEqual((await post(`/usuario/verificar/${pending.shareToken}`)).body, { existe: false });
	assert.deepEqual((await post(`/usuario/verificar/${'A'.repeat(43)}`)).body, { existe: false });

	// Audit writes are fire-and-forget; wait for them to land.
	let audits = [];
	for (let i = 0; i < 50 && audits.length < 3; i++) {
		audits = await prisma.auditLog.findMany({ where: { action: 'passport.verify_token' } });
		if (audits.length < 3) await new Promise(r => setTimeout(r, 50));
	}
	assert.equal(audits.length, 3);
	for (const a of audits) assert.equal(JSON.stringify(a).includes(accepted.shareToken), false);
});

test('LEGACY_NUMBER_LINKS=0 closes number links; tokens keep working', { skip }, async () => {
	const accepted = await Usuario.findByPassportNumber(1002);
	process.env.LEGACY_NUMBER_LINKS = '0';
	try {
		assert.deepEqual((await post('/usuario/verificar/00000002T/1002')).body, { existe: false });
		assert.equal((await post(`/usuario/verificar/${accepted.shareToken}`)).body.existe, true);
	} finally {
		delete process.env.LEGACY_NUMBER_LINKS;
	}
	assert.equal((await post('/usuario/verificar/00000002T/1002')).body.existe, true);
});

test('the holder sees their own token in /usuario/me', { skip }, async () => {
	const accepted = await Usuario.findByPassportNumber(1003);
	const login = await post('/usuario/login', { user: 'holder3@example.test', password: 'clave-de-prueba' });
	assert.equal(login.status, 200);
	assert.equal(JSON.stringify(login.body).includes(accepted.shareToken), false);
	const cookie = (login.headers.getSetCookie() || []).find(c => c.startsWith('token='));
	const me = await fetch(`${base}/usuario/me`, { headers: { cookie: cookie.split(';')[0] } });
	assert.equal(me.status, 200);
	const body = await me.json();
	assert.equal(body.shareToken, accepted.shareToken);
	assert.equal(body.numeroPasaporte, 1003);
});
