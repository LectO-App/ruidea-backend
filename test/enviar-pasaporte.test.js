const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// POST /usuario/enviar-pasaporte through the real route, against an in-memory stand-in for
// the Prisma client. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const rows = [];
const audits = [];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row);
const fake = {
	usuario: {
		findUnique: async ({ where, select }) => {
			const row = rows.find(r => matches(r, where));
			return row ? pick(row, select) : null;
		},
	},
	auditLog: { create: async ({ data }) => audits.push(data) },
};
require('../db/prisma').getPrisma = () => fake;

const sent = [];
let failMail = false;
require('nodemailer').createTransport = () => ({
	sendMail: async message => {
		if (failMail) throw new Error('smtp down');
		sent.push(message);
	},
});

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CSRF = 'csrf-sintetico';

const row = (overrides = {}) => ({
	id: A,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	numeroDocumento: 'SINT-0001',
	fechaNacimiento: new Date('2010-01-01T00:00:00Z'),
	correoElectronico: 'holder@example.test',
	dislexia: true,
	emailVerificado: true,
	estado: 'aceptado',
	numeroPasaporte: 1042,
	shareToken: 'tok_sintetico_123',
	tokenVersion: 0,
	...overrides,
});

let server;
let base;
let ip = 0;
before(async () => {
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
	sent.length = 0;
	audits.length = 0;
	failMail = false;
});

const session = signToken({ id: A, role: 'user', csrf: CSRF, tv: 0 }, { expiresIn: '1h' });
const send = async ({ csrf = CSRF, forwardedFor } = {}) => {
	const res = await fetch(`${base}/usuario/enviar-pasaporte`, {
		method: 'POST',
		headers: {
			cookie: `token=${session}`,
			'x-csrf-token': csrf,
			'x-forwarded-for': forwardedFor || `198.51.100.${++ip % 250}`,
		},
	});
	return { status: res.status, data: await res.json() };
};

test('an approved holder gets the passport card at the account address, and it is audited', async () => {
	rows.splice(0, rows.length, row());
	const res = await send();
	assert.equal(res.status, 200);
	assert.deepEqual(res.data, { ok: true });
	assert.equal(sent.length, 1);
	assert.equal(sent[0].to, 'holder@example.test');
	assert.match(sent[0].html, /cid:pasaporte-qr/);
	assert.ok(!sent[0].html.includes('SINT-0001'));
	const audit = audits.find(a => a.action === 'passport.email');
	assert.equal(audit.outcome, 'success');
	assert.equal(audit.target, A);
});

for (const [name, overrides] of [
	['pending', { estado: 'pendiente' }],
	['unverified email', { emailVerificado: false }],
]) {
	test(`a holder who is not approved (${name}) gets 409 and no email`, async () => {
		rows.splice(0, rows.length, row(overrides));
		const res = await send();
		assert.equal(res.status, 409);
		assert.equal(sent.length, 0);
	});
}

test('the CSRF header is required', async () => {
	rows.splice(0, rows.length, row());
	const res = await send({ csrf: 'otro' });
	assert.equal(res.status, 403);
	assert.equal(sent.length, 0);
});

test('a mail failure answers 502 and is audited as failed', async () => {
	rows.splice(0, rows.length, row());
	failMail = true;
	const res = await send();
	assert.equal(res.status, 502);
	assert.equal(audits.find(a => a.action === 'passport.email').outcome, 'failed');
});

test('the route sits behind the email rate limit', async () => {
	rows.splice(0, rows.length, row());
	const statuses = [];
	for (let i = 0; i < 16; i++) statuses.push((await send({ forwardedFor: '203.0.113.9' })).status);
	assert.equal(statuses.filter(s => s === 200).length, 15);
	assert.equal(statuses[15], 429);
});
