const { test, before, after } = require('node:test');
const assert = require('node:assert');

// Confirming the email with the 6-digit code, and fixing a mistyped address before it is
// confirmed, through the real routes against an in-memory stand-in for the Prisma client.
// All data is synthetic.
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
		update: async ({ where, data }) => {
			const row = rows.find(r => matches(r, where));
			if (!row) throw Object.assign(new Error('missing'), { code: 'P2025' });
			if (data.correoElectronico && rows.some(r => r !== row && r.correoElectronico === data.correoElectronico)) {
				throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['correoElectronico'] } });
			}
			Object.assign(row, data);
			return row;
		},
	},
	auditLog: {
		create: async ({ data }) => {
			audits.push(data);
			return {};
		},
	},
};
require('../db/prisma').getPrisma = () => fake;

const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');
const { emailCode } = require('../functions/emailCode');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TYPO = 'prueba@gmial.com';
const FIXED = 'prueba@gmail.com';

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
	password: 'hash',
	emailVerificado: false,
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	estado: 'pendiente',
	mensajeMedico: '',
	numeroPasaporte: -1,
	aceptoRecibirInfo: false,
	aceptoSolicitud: true,
	fechaConsentimiento: null,
	fechaEnvio: null,
	archivoBlob: 'blob-sintetico',
	extra: null,
	tokenVersion: 0,
	...overrides,
});
const reset = list => {
	rows.splice(0, rows.length, ...list);
	audits.length = 0;
	sent.length = 0;
};

let server;
let base;
let ip = 0;
before(async () => {
	const app = express();
	app.set('trust proxy', 1);
	app.use(express.json());
	app.use(cookieParser());
	app.use('/emailVerification', require('../routes/emailVerification'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const CSRF = 'csrf-sintetico';
const sessionFor = id => signToken({ id, role: 'user', csrf: CSRF, tv: 0 }, { expiresIn: '1h' });

const call = async (path, { id, body } = {}) => {
	const headers = { 'x-forwarded-for': `198.51.100.${++ip % 250}`, 'content-type': 'application/json' };
	if (id) {
		headers.cookie = `token=${sessionFor(id)}`;
		headers['x-csrf-token'] = CSRF;
	}
	const res = await fetch(base + path, { method: 'POST', headers, body: body && JSON.stringify(body) });
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, data, text };
};

const linkToken = message => /verificarEmail\/([A-Za-z0-9_.-]+)/.exec(message.html)[1];
const codeIn = message => /(\d{3}) (\d{3})/.exec(message.text).slice(1).join('');

test('the right code confirms the email', async () => {
	reset([user(A, { correoElectronico: TYPO })]);
	const res = await call('/emailVerification/codigo', { id: A, body: { codigo: emailCode(A, TYPO) } });
	assert.equal(res.status, 200);
	assert.deepEqual(res.data, { emailVerificado: true });
	assert.equal(rows[0].emailVerificado, true);
});

test('a code with a space in the middle is accepted', async () => {
	reset([user(A)]);
	const code = emailCode(A, rows[0].correoElectronico);
	const res = await call('/emailVerification/codigo', { id: A, body: { codigo: `${code.slice(0, 3)} ${code.slice(3)}` } });
	assert.equal(res.status, 200);
});

test('a code from 23 hours ago still works; one from 25 hours ago does not', async () => {
	const hour = 60 * 60 * 1000;
	reset([user(A)]);
	const address = rows[0].correoElectronico;
	const old = emailCode(A, address, Date.now() - 23 * hour);
	assert.equal((await call('/emailVerification/codigo', { id: A, body: { codigo: old } })).status, 200);

	reset([user(A)]);
	const expired = emailCode(A, address, Date.now() - 25 * hour);
	const current = emailCode(A, address);
	if (expired !== current) {
		assert.equal((await call('/emailVerification/codigo', { id: A, body: { codigo: expired } })).status, 400);
		assert.equal(rows[0].emailVerificado, false);
	}
});

test('a wrong code is refused with a plain message, and the fifth wrong try locks the code', async () => {
	reset([user(B)]);
	const right = emailCode(B, rows[0].correoElectronico);
	const wrong = right === '000000' ? '111111' : '000000';
	for (let i = 1; i <= 4; i++) {
		const res = await call('/emailVerification/codigo', { id: B, body: { codigo: wrong } });
		assert.equal(res.status, 400);
		assert.match(res.data.message, /no es correcto/);
	}
	const fifth = await call('/emailVerification/codigo', { id: B, body: { codigo: wrong } });
	assert.equal(fifth.status, 400);
	assert.match(fifth.data.message, /varias veces/);
	const locked = await call('/emailVerification/codigo', { id: B, body: { codigo: right } });
	assert.equal(locked.status, 429);
	assert.equal(rows[0].emailVerificado, false);
	assert.ok(audits.every(a => a.outcome === 'denied' && !JSON.stringify(a).includes(wrong)));
});

test('the code route needs a session and six digits', async () => {
	reset([user(A)]);
	assert.equal((await call('/emailVerification/codigo', { body: { codigo: '123456' } })).status, 401);
	assert.equal((await call('/emailVerification/codigo', { id: A, body: { codigo: '12345' } })).status, 400);
	assert.equal((await call('/emailVerification/codigo', { id: A, body: { codigo: { $gt: '' } } })).status, 400);
});

test('the verification email carries the code in the HTML and the plain text, and it works', async () => {
	reset([user(A, { correoElectronico: TYPO })]);
	await require('../functions/sendEmail').sendEmail(A);
	const [message] = sent;
	const code = codeIn(message);
	assert.equal(code, emailCode(A, TYPO));
	assert.ok(message.html.includes(`${code.slice(0, 3)} ${code.slice(3)}`));
	assert.match(message.text, /24 horas/);
	assert.equal((await call('/emailVerification/codigo', { id: A, body: { codigo: code } })).status, 200);
});

test('changing the address sends a new link and code to the new address only, and changes nothing else', async () => {
	reset([user(A, { correoElectronico: TYPO, numeroPasaporte: 1234 })]);
	const before = { ...rows[0] };
	const res = await call('/emailVerification/correo', { id: A, body: { correoElectronico: '  Prueba@GMAIL.com ' } });
	assert.equal(res.status, 200);
	assert.deepEqual(res.data, { correoElectronico: FIXED });
	assert.equal(rows[0].correoElectronico, FIXED);
	for (const key of ['estado', 'archivoBlob', 'numeroPasaporte', 'emailVerificado', 'nombre']) {
		assert.equal(rows[0][key], before[key], key);
	}
	assert.equal(sent.length, 1);
	assert.equal(sent[0].to, FIXED);
	assert.equal(codeIn(sent[0]), emailCode(A, FIXED));

	assert.equal(audits.length, 1);
	assert.equal(audits[0].action, 'user.email_change');
	assert.ok(!JSON.stringify(audits).includes('gmail') && !JSON.stringify(audits).includes('gmial'));
});

test('after a change, the link and the code sent to the old address are refused', async () => {
	reset([user(A, { correoElectronico: TYPO })]);
	await require('../functions/sendEmail').sendEmail(A);
	const oldLink = linkToken(sent[0]);
	const oldCode = codeIn(sent[0]);

	assert.equal((await call('/emailVerification/correo', { id: A, body: { correoElectronico: FIXED } })).status, 200);
	const newLink = linkToken(sent[1]);

	assert.equal((await call(`/emailVerification/confirm/${oldLink}`)).status, 400);
	if (oldCode !== emailCode(A, FIXED)) {
		assert.equal((await call('/emailVerification/codigo', { id: A, body: { codigo: oldCode } })).status, 400);
	}
	assert.equal(rows[0].emailVerificado, false);

	sent.length = 0;
	assert.equal((await call(`/emailVerification/resend/${oldLink}`)).status, 200);
	assert.equal(sent.length, 0, 'the old link cannot trigger mail');

	assert.equal((await call(`/emailVerification/confirm/${newLink}`)).status, 200);
	assert.equal(rows[0].emailVerificado, true);
});

test('a link without the address binding is refused', async () => {
	reset([user(A)]);
	const legacy = signToken({ id: A, purpose: 'email-verify' }, { expiresIn: '1h' });
	assert.equal((await call(`/emailVerification/confirm/${legacy}`)).status, 400);
	assert.equal(rows[0].emailVerificado, false);
});

test('an address another account uses answers 409 with a kind message that does not repeat it', async () => {
	reset([user(A, { correoElectronico: TYPO }), user(B, { correoElectronico: FIXED, emailVerificado: true })]);
	const res = await call('/emailVerification/correo', { id: A, body: { correoElectronico: FIXED } });
	assert.equal(res.status, 409);
	assert.match(res.data.message, /Ya hay una cuenta con este correo/);
	assert.ok(!res.text.includes(FIXED));
	assert.equal(rows[0].correoElectronico, TYPO);
	assert.equal(sent.length, 0);
});

test('a confirmed account cannot change its address here', async () => {
	reset([user(A, { emailVerificado: true })]);
	const res = await call('/emailVerification/correo', { id: A, body: { correoElectronico: FIXED } });
	assert.equal(res.status, 409);
	assert.match(res.data.message, /ya está confirmado/);
	assert.equal(rows[0].correoElectronico, `${A}@example.test`);
	assert.equal(sent.length, 0);
});

test('an unfinished application cannot change its address here', async () => {
	reset([user(A, { estado: 'borrador' })]);
	const res = await call('/emailVerification/correo', { id: A, body: { correoElectronico: FIXED } });
	assert.equal(res.status, 409);
	assert.equal(rows[0].correoElectronico, `${A}@example.test`);
});

test('an incomplete address is refused in Spanish and without echoing it', async () => {
	reset([user(A)]);
	const res = await call('/emailVerification/correo', { id: A, body: { correoElectronico: 'prueba@gmail' } });
	assert.equal(res.status, 400);
	assert.match(res.data.errors[0].message, /no está completo/);
	assert.ok(!res.text.includes('prueba@gmail'));
});
