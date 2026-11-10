const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Session revocation (tokenVersion) through the real routes, against an in-memory stand-in
// for the Prisma client. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const rows = [];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row);
const apply = (row, data) => {
	for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
};
const fake = {
	usuario: {
		findUnique: async ({ where, select }) => {
			const row = rows.find(r => matches(r, where));
			return row ? pick(row, select) : null;
		},
		findFirst: async ({ where }) => rows.find(r => matches(r, where)) || null,
		update: async ({ where, data, select }) => {
			const row = rows.find(r => matches(r, where));
			if (!row) throw Object.assign(new Error('missing'), { code: 'P2025' });
			apply(row, data);
			return pick(row, select);
		},
		updateMany: async ({ where, data }) => {
			const hit = rows.filter(r => matches(r, where));
			for (const row of hit) apply(row, data);
			return { count: hit.length };
		},
	},
	auditLog: { create: async () => ({}) },
};
require('../db/prisma').getPrisma = () => fake;

// Capture outgoing mail instead of sending it.
const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });

const bcrypt = require('bcrypt');
const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken, verifyToken } = require('../functions/tokens');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PASSWORD = 'Clave-Sintetica-1';
let hash;

const user = (id, overrides = {}) => ({
	id,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	paisResidencia: 'Argentina',
	localidadResidencia: 'Ciudad Ficticia',
	lugarNacimiento: 'Pueblo Ficticio',
	tipoDocumento: null,
	numeroDocumento: 'SINT-0001',
	fechaNacimiento: new Date('2010-01-01T00:00:00Z'),
	correoElectronico: `${id}@example.test`,
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
	password: hash,
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
	tokenVersion: 0,
	...overrides,
});
const reset = list => rows.splice(0, rows.length, ...list);

let server;
let base;
let ip = 0;
before(async () => {
	hash = await bcrypt.hash(PASSWORD, 4);
	const app = express();
	app.set('trust proxy', 1);
	app.use(express.json());
	app.use(cookieParser());
	app.use('/usuario', require('../routes/usuario'));
	app.use('/inscripcion', require('../routes/inscripcion'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

// One request; a fresh X-Forwarded-For each time keeps the per-IP rate limiters out of the way.
const call = async (method, path, { session, csrf, body } = {}) => {
	const headers = { 'x-forwarded-for': `198.51.100.${++ip % 250}` };
	if (session) headers.cookie = `token=${session}`;
	if (csrf) headers['x-csrf-token'] = csrf;
	if (body) headers['content-type'] = 'application/json';
	const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
	const cookie = (res.headers.getSetCookie() || []).find(c => c.startsWith('token='));
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, data, session: cookie && cookie.slice(6, cookie.indexOf(';')) };
};
const login = async password => {
	const res = await call('POST', '/usuario/login', { body: { user: `${A}@example.test`, password } });
	return { status: res.status, session: res.session, csrf: res.data.csrfToken };
};
const me = session => call('GET', '/usuario/me', { session }).then(r => r.status);
const changePassword = (token, password) => call('POST', '/usuario/change-password', { body: { token, password } }).then(r => r.status);

test('a reset link works once, and the reset ends existing sessions', async () => {
	reset([user(A)]);
	const s = await login(PASSWORD);
	assert.equal(s.status, 200);
	assert.equal(await me(s.session), 200);

	const token = signToken({ id: A, purpose: 'password-reset', tv: 0 });
	assert.equal(await changePassword(token, 'Clave-Nueva-1'), 200);
	assert.equal(await changePassword(token, 'Clave-Otra-1'), 400);
	assert.equal(await me(s.session), 401);
	assert.equal((await login('Clave-Nueva-1')).status, 200);
	assert.equal((await login('Clave-Otra-1')).status, 401);
});

test('the reset email link carries the current tokenVersion and is spent by its first use', async () => {
	reset([user(A, { tokenVersion: 3 })]);
	sent.length = 0;
	assert.equal((await call('POST', '/usuario/forgot-password', { body: { email: `${A}@example.test` } })).status, 200);
	const token = /cambiarContrase[^/]*\/([A-Za-z0-9_.-]+)/.exec(sent[0].html)[1];
	assert.equal(verifyToken(token).tv, 3);
	assert.equal(await changePassword(token, 'Clave-Nueva-1'), 200);
	assert.equal(rows[0].tokenVersion, 4);
	assert.equal(await changePassword(token, 'Clave-Otra-1'), 400);
});

test('sessions and reset links issued before the claim existed count as version 0', async () => {
	reset([user(A)]);
	const csrf = 'legacy-csrf';
	const legacySession = signToken({ id: A, role: 'user', csrf }, { expiresIn: '1h' });
	assert.equal(await me(legacySession), 200);

	const legacyReset = signToken({ id: A, purpose: 'password-reset' });
	assert.equal(await changePassword(legacyReset, 'Clave-Nueva-1'), 200);
	assert.equal(await changePassword(legacyReset, 'Clave-Otra-1'), 400);
	assert.equal(await me(legacySession), 401);
});

test('logout ends every session of the account; logging in again works', async () => {
	reset([user(A)]);
	const one = await login(PASSWORD);
	const two = await login(PASSWORD);
	const out = await call('POST', '/usuario/logout', { session: one.session, csrf: one.csrf });
	assert.equal(out.status, 200);
	assert.equal(out.session, ''); // cookie cleared
	assert.equal(await me(one.session), 401);
	assert.equal(await me(two.session), 401);
	// Logging out again with the dead cookie changes nothing.
	assert.equal((await call('POST', '/usuario/logout', { session: one.session, csrf: one.csrf })).status, 200);
	assert.equal(rows[0].tokenVersion, 1);

	const again = await login(PASSWORD);
	assert.equal(again.status, 200);
	assert.equal(await me(again.session), 200);
});

test('logout without the CSRF header clears the cookie but revokes nothing', async () => {
	reset([user(A)]);
	const s = await login(PASSWORD);
	const out = await call('POST', '/usuario/logout', { session: s.session });
	assert.equal(out.status, 200);
	assert.equal(out.session, '');
	assert.equal(await me(s.session), 200);
	assert.equal(rows[0].tokenVersion, 0);
});

test('a new password from the profile ends other sessions and reissues the owner session', async () => {
	reset([user(A)]);
	const other = await login(PASSWORD);
	const self = await login(PASSWORD);
	const body = {
		_id: A,
		nombre: 'Prueba',
		apellidos: 'Sintética',
		paisResidencia: 'Argentina',
		localidadResidencia: 'Ciudad Ficticia',
		lugarNacimiento: 'Pueblo Ficticio',
		numeroDocumento: 'SINT-0001',
		fechaNacimiento: '2010-01-01',
		correoElectronico: `${A}@example.test`,
		numeroTelefono: '+5491136622676',
		diagnostico: { dislexia: true, discalculia: false, disortografía: false, dispraxia: false, tdah: false },
		esTutor: false,
		password: 'Clave-Nueva-1',
	};
	const res = await call('PUT', '/inscripcion/actualizar', { session: self.session, csrf: self.csrf, body });
	assert.equal(res.status, 200);
	assert.ok(res.data.csrfToken);
	assert.ok(res.session);
	assert.equal(await me(other.session), 401);
	assert.equal(await me(self.session), 401);
	assert.equal(await me(res.session), 200);
	assert.equal((await login('Clave-Nueva-1')).status, 200);

	// A profile edit without a new password leaves sessions alone.
	delete body.password;
	const fresh = await login('Clave-Nueva-1');
	const plain = await call('PUT', '/inscripcion/actualizar', { session: fresh.session, csrf: fresh.csrf, body });
	assert.equal(plain.status, 200);
	assert.equal(plain.data.csrfToken, undefined);
	assert.equal(await me(fresh.session), 200);
});

test('the session of a deleted account is refused', async () => {
	reset([user(A)]);
	const s = await login(PASSWORD);
	reset([]);
	assert.equal(await me(s.session), 401);
});
