const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// Sign-in by emailed link (POST /usuario/enlace, POST /usuario/enlace/entrar) through the real
// routes, against an in-memory stand-in for the Prisma client. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.FRONTEND_URL = 'http://front.example.test';

const rows = [];
const audits = [];
const matchesValue = (value, cond) => {
	if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
		if ('gt' in cond) return value != null && value > cond.gt;
		if ('not' in cond) return value !== cond.not;
	}
	if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
	return value === cond;
};
const matches = (row, where) => Object.entries(where).every(([k, v]) => matchesValue(row[k], v));
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
	auditLog: { create: async ({ data }) => audits.push(data) },
};
require('../db/prisma').getPrisma = () => fake;

const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });

const bcrypt = require('bcrypt');
const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken, verifyToken } = require('../functions/tokens');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const EMAIL = `${A}@example.test`;
const PASSWORD = 'Clave-Sintetica-1';
const INVALID = 'Este enlace ya no sirve. Pide uno nuevo.';
let hash;

const user = (overrides = {}) => ({
	id: A,
	nombre: '<b>Prueba</b>',
	apellidos: 'Sintética',
	correoElectronico: EMAIL,
	password: hash,
	emailVerificado: true,
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	estado: 'aceptado',
	numeroPasaporte: 1001,
	tokenVersion: 0,
	magicLinkHash: null,
	magicLinkExpira: null,
	...overrides,
});

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
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());
beforeEach(() => {
	rows.splice(0, rows.length, user());
	sent.length = 0;
	audits.length = 0;
});

const call = async (method, path, { session, body } = {}) => {
	const headers = { 'x-forwarded-for': `198.51.100.${++ip % 250}` };
	if (session) headers.cookie = `token=${session}`;
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
const settle = () => new Promise(resolve => setImmediate(resolve));
const requestLink = body => call('POST', '/usuario/enlace', { body });
const enter = token => call('POST', '/usuario/enlace/entrar', { body: { token } });
const me = session => call('GET', '/usuario/me', { session }).then(r => r.status);
const linkToken = mail => /\/entrar\/([A-Za-z0-9_.-]+)"/.exec(mail.html)[1];
const sendLink = async (body = { email: EMAIL }) => {
	sent.length = 0;
	assert.equal((await requestLink(body)).status, 200);
	return linkToken(sent[0]);
};

test('an unknown email gets the same answer as a known one, and no email', async () => {
	const known = await requestLink({ email: EMAIL });
	const unknown = await requestLink({ email: 'nadie@example.test' });
	assert.equal(known.status, 200);
	assert.equal(unknown.status, 200);
	assert.deepStrictEqual(unknown.data, known.data);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].to, EMAIL);
});

test('the request validates its input', async () => {
	assert.equal((await requestLink({ email: 'no-es-un-correo' })).status, 400);
	for (const next of ['https://evil.example/', '//evil.example/x', '/\\evil.example', 'dashboard']) {
		assert.equal((await requestLink({ email: EMAIL, next })).status, 400, next);
	}
	assert.equal(sent.length, 0);
});

test('the email follows the template, escapes the name and links to the front end', async () => {
	await requestLink({ email: EMAIL });
	const [mail] = sent;
	assert.equal(mail.subject, 'Entra a RUIDEA');
	assert.match(mail.html, /Entra a RUIDEA/);
	assert.match(mail.html, /¡Hola, &lt;b&gt;Prueba&lt;\/b&gt;!/);
	assert.ok(!mail.html.includes('<b>Prueba</b>'));
	assert.match(mail.html, /Toca el botón para entrar\. No hace falta contraseña\./);
	assert.match(mail.html, /Sirve 15 minutos\. Si no lo pediste tú, no hagas nada: nadie puede entrar sin este correo\./);
	assert.match(mail.html, /href="http:\/\/front\.example\.test\/entrar\/[A-Za-z0-9_.-]+"/);
	assert.match(mail.text, /Entrar a RUIDEA: http:\/\/front\.example\.test\/entrar\//);
});

test('the link signs in once, returns the session like login, and carries the next path', async () => {
	const token = await sendLink({ email: EMAIL, next: '/mostrar' });
	assert.equal(verifyToken(token).purpose, 'magic-login');
	assert.ok(rows[0].magicLinkHash, 'a hashed nonce is stored');
	assert.ok(!JSON.stringify(rows[0]).includes(verifyToken(token).n), 'the nonce itself is not stored');

	const res = await enter(token);
	assert.equal(res.status, 200);
	assert.equal(res.data.correcto, true);
	assert.ok(res.data.csrfToken);
	assert.equal(res.data.next, '/mostrar');
	assert.equal(await me(res.session), 200);
	assert.equal(rows[0].magicLinkHash, null);
});

test('a used link is refused with the fixed message', async () => {
	const token = await sendLink();
	assert.equal((await enter(token)).status, 200);
	const again = await enter(token);
	assert.equal(again.status, 400);
	assert.deepStrictEqual(again.data, { correcto: false, message: INVALID });
	assert.equal(again.session, undefined);
});

test('two concurrent uses of one link let only one through', async () => {
	const token = await sendLink();
	const results = await Promise.all([enter(token), enter(token), enter(token)]);
	assert.deepStrictEqual(results.map(r => r.status).sort(), [200, 400, 400]);
});

test('an expired link is refused, by the token and by the stored expiry', async () => {
	const token = await sendLink();
	const { id, tv, n } = verifyToken(token);
	const expired = signToken({ id, purpose: 'magic-login', tv, n }, { expiresIn: -10 });
	assert.deepStrictEqual((await enter(expired)).data, { correcto: false, message: INVALID });

	rows[0].magicLinkExpira = new Date(Date.now() - 1000);
	assert.equal((await enter(token)).status, 400);
});

test('the link lasts 15 minutes', async () => {
	const { iat, exp } = verifyToken(await sendLink());
	assert.equal(exp - iat, 15 * 60);
	const stored = rows[0].magicLinkExpira.getTime() - Date.now();
	assert.ok(stored > 14 * 60 * 1000 && stored <= 15 * 60 * 1000);
});

test('asking again replaces the previous link', async () => {
	const first = await sendLink();
	const second = await sendLink();
	assert.equal((await enter(first)).status, 400);
	assert.equal((await enter(second)).status, 200);
});

test('tokens with another purpose are refused, and the link is no reset or session token', async () => {
	const token = await sendLink();
	const { n } = verifyToken(token);
	for (const purpose of ['password-reset', 'email-verify', undefined]) {
		const other = signToken({ id: A, purpose, tv: 0, n, role: 'user', csrf: 'x' });
		const res = await enter(other);
		assert.deepStrictEqual(res.data, { correcto: false, message: INVALID }, String(purpose));
	}
	const reset = await call('POST', '/usuario/change-password', { body: { token, password: 'Clave-Nueva-1' } });
	assert.equal(reset.status, 400);
	assert.equal(rows[0].password, hash);
	assert.equal(await me(token), 401);
	assert.equal((await enter(token)).status, 200, 'the refused attempts did not spend the link');
});

test('a link issued before the account tokenVersion changed is refused', async () => {
	const token = await sendLink();
	rows[0].tokenVersion = 1;
	assert.equal((await enter(token)).status, 400);
});

test('signing in by link keeps the other sessions of the account', async () => {
	const login = await call('POST', '/usuario/login', { body: { user: EMAIL, password: PASSWORD } });
	assert.equal(login.status, 200);
	const res = await enter(await sendLink());
	assert.equal(res.status, 200);
	assert.equal(rows[0].tokenVersion, 0);
	assert.equal(await me(login.session), 200);
	assert.equal(await me(res.session), 200);
});

test('requests and uses are audited without the email, the token or personal data', async () => {
	await requestLink({ email: EMAIL, next: '/mostrar' });
	await requestLink({ email: 'nadie@example.test' });
	const token = linkToken(sent[0]);
	await enter(token);
	await enter(token);
	await settle();
	assert.deepStrictEqual(
		audits.map(a => [a.action, a.outcome]),
		[
			['user.magic_link.request', 'success'],
			['user.magic_link.request', 'not_found'],
			['user.magic_link.login', 'success'],
			['user.magic_link.login', 'denied'],
		]
	);
	const text = JSON.stringify(audits);
	for (const secret of [EMAIL, 'nadie@example.test', token, verifyToken(token).n, 'Prueba', '/mostrar']) {
		assert.ok(!text.includes(secret), `audit holds ${secret}`);
	}
});
