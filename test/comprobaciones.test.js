const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// The holder's own check history (GET /usuario/me/comprobaciones) and share-link rotation
// (POST /usuario/me/enlace), against an in-memory stand-in for the Prisma client. All data
// is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.VERIFY_PASSWORD = 'shared-test-password';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const C = 'c'.repeat(24);
const TOKEN_A = `${'A'.repeat(42)}0`;
const TOKEN_B = `${'B'.repeat(42)}0`;
const NOW = Date.now();
const daysAgo = d => new Date(NOW - d * 24 * 60 * 60 * 1000);

let usuarios = [];
let audits = [];
let verifiers = [];
let auditQueries = [];

const baseUser = (id, overrides) => ({
	id,
	nombre: 'Prueba',
	apellidos: 'Sintética',
	numeroDocumento: `SINT-${id.slice(0, 4)}`,
	correoElectronico: `${id}@example.test`,
	password: 'x',
	fechaCreacion: new Date('2026-01-01T00:00:00Z'),
	tokenVersion: 0,
	extra: {},
	...overrides,
});

const matches = (row, where) =>
	Object.entries(where).every(([k, v]) => {
		if (v && typeof v === 'object' && !(v instanceof Date)) {
			if ('in' in v) return v.in.includes(row[k]);
			if ('gte' in v) return row[k] >= v.gte;
		}
		return row[k] === v;
	});
const pick = (row, select) => (select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, row[k]])) : row);

const fake = {
	usuario: {
		findUnique: async ({ where, select }) => {
			const row = usuarios.find(r => matches(r, where));
			return row ? pick(row, select) : null;
		},
		findFirst: async ({ where }) => usuarios.find(r => matches(r, where)) || null,
	},
	// UPDATE "usuarios" SET "shareToken" = DEFAULT WHERE id = $1 AND estado = 'aceptado' RETURNING ...
	$queryRaw: async (strings, ...values) => {
		const sql = strings.join('?');
		assert.match(sql, /SET "shareToken" = DEFAULT/);
		assert.match(sql, /estado = 'aceptado'/);
		const row = usuarios.find(r => r.id === values[0] && r.estado === 'aceptado');
		if (!row) return [];
		row.shareToken = crypto.randomBytes(32).toString('base64url');
		return [{ shareToken: row.shareToken, numeroPasaporte: row.numeroPasaporte }];
	},
	auditLog: {
		create: async ({ data }) => audits.push({ at: new Date(), ...data }),
		findMany: async args => {
			auditQueries.push(args);
			return audits
				.filter(r => matches(r, args.where))
				.sort((x, y) => y.at - x.at)
				.slice(0, args.take)
				.map(r => pick(r, args.select));
		},
	},
	verifier: {
		findFirst: async () => null,
		findMany: async ({ where, select }) => verifiers.filter(v => matches(v, where)).map(v => pick(v, select)),
	},
};
require('../db/prisma').getPrisma = () => fake;

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');

const csrf = 'f'.repeat(64);
const cookieFor = id => `token=${signToken({ id, role: 'user', csrf, tv: 0 }, { expiresIn: '1h' })}`;

let server;
let base;
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

const audit = (action, target, at, extra = {}) => ({
	id: crypto.randomBytes(12).toString('hex'),
	action,
	target: String(target),
	outcome: 'success',
	actorType: 'anonymous',
	actorId: null,
	ip: null,
	meta: { country: 'ES', device: 'mobile' },
	at,
	...extra,
});

beforeEach(() => {
	usuarios = [
		baseUser(A, { estado: 'aceptado', numeroPasaporte: 1001, shareToken: TOKEN_A }),
		baseUser(B, { estado: 'aceptado', numeroPasaporte: 1002, shareToken: TOKEN_B }),
		baseUser(C, { estado: 'pendiente', numeroPasaporte: 0, shareToken: `${'C'.repeat(42)}0` }),
	];
	verifiers = [{ id: 'v1', nombre: 'Universidad de Ejemplo', keyHash: 'h' }];
	auditQueries = [];
	audits = [
		audit('passport.verify_token', 1001, daysAgo(1), { meta: { country: 'ES', device: 'mobile' } }),
		audit('passport.lookup', 1001, daysAgo(3), { actorType: 'verifier', actorId: 'v1', meta: { country: 'AR', device: 'desktop' } }),
		// The public page the verifier opened right after its lookup: part of the same check.
		audit('passport.verify_token', 1001, new Date(daysAgo(3).getTime() + 30 * 1000)),
		audit('passport.lookup', 1001, daysAgo(5), { actorId: 'shared', meta: { country: null, device: 'other' } }),
		audit('passport.verify_link', 1001, daysAgo(10), { meta: { country: 'UY', device: 'desktop' } }),
		audit('passport.verify_token', 1001, daysAgo(2), { outcome: 'not_found' }),
		audit('passport.lookup', 1001, daysAgo(4), { outcome: 'document_mismatch', actorId: 'v1' }),
		audit('passport.download', 1001, daysAgo(1)),
		audit('passport.verify_token', 1001, daysAgo(120)),
		audit('passport.verify_token', 1002, daysAgo(1), { meta: { country: 'FR', device: 'desktop' } }),
		audit('passport.lookup', 1002, daysAgo(2), { actorId: 'v1' }),
	];
});

const get = async (path, cookie) => {
	const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
	return { status: res.status, body: await res.json() };
};
const post = async (path, { cookie, headers = {} } = {}) => {
	const res = await fetch(base + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
		body: '{}',
	});
	return { status: res.status, body: await res.json() };
};

test('the history lists only successful checks of the caller’s own passport in the last 90 days, newest first', async () => {
	const { status, body } = await get('/usuario/me/comprobaciones', cookieFor(A));
	assert.equal(status, 200);
	assert.equal(body.dias, 90);
	assert.equal(body.total, 4);
	assert.deepEqual(
		body.comprobaciones.map(c => [c.tipo, c.pais, c.dispositivo, c.entidad]),
		[
			['qr_o_enlace', 'ES', 'mobile', undefined],
			['entidad', 'AR', 'desktop', 'Universidad de Ejemplo'],
			['entidad', null, 'other', 'una entidad verificadora'],
			['qr_o_enlace', 'UY', 'desktop', undefined],
		]
	);
	const fechas = body.comprobaciones.map(c => Date.parse(c.fecha));
	assert.deepEqual(fechas, [...fechas].sort((x, y) => y - x));
	assert.ok(fechas.every(Number.isFinite));
});

test('the history never carries IPs, audit ids, verifier ids, tokens or another holder’s checks', async () => {
	audits[1].ip = '203.0.113.9';
	const { body } = await get('/usuario/me/comprobaciones', cookieFor(A));
	const text = JSON.stringify(body);
	for (const secret of ['203.0.113.9', 'v1', TOKEN_A, TOKEN_B, 'FR', ...audits.map(a => a.id)]) {
		assert.ok(!text.includes(secret), secret);
	}
	for (const c of body.comprobaciones) {
		assert.deepEqual(Object.keys(c).sort(), (c.tipo === 'entidad' ? ['dispositivo', 'entidad', 'fecha', 'pais', 'tipo'] : ['dispositivo', 'fecha', 'pais', 'tipo']));
	}
	assert.ok(auditQueries.every(q => q.where.target === '1001'));
});

test('the history is capped at 50 entries; total still counts every check in the window', async () => {
	for (let i = 0; i < 60; i++) audits.push(audit('passport.verify_token', 1001, new Date(NOW - (i + 1) * 60 * 60 * 1000)));
	const { body } = await get('/usuario/me/comprobaciones', cookieFor(A));
	assert.equal(body.comprobaciones.length, 50);
	assert.equal(body.total, 64);
});

test('a holder whose passport is not accepted gets an empty history', async () => {
	audits.push(audit('passport.verify_token', 0, daysAgo(1)));
	const { status, body } = await get('/usuario/me/comprobaciones', cookieFor(C));
	assert.equal(status, 200);
	assert.deepEqual(body, { dias: 90, total: 0, comprobaciones: [] });
	assert.equal(auditQueries.length, 0);
});

test('the history needs a session', async () => {
	assert.equal((await get('/usuario/me/comprobaciones')).status, 401);
});

test('changing the link gives a fresh token, kills the old one and leaves other holders alone', async () => {
	const before = await post(`/usuario/verificar/${TOKEN_A}`);
	assert.equal(before.body.existe, true);

	const { status, body } = await post('/usuario/me/enlace', { cookie: cookieFor(A), headers: { 'x-csrf-token': csrf } });
	assert.equal(status, 200);
	assert.match(body.shareToken, /^[A-Za-z0-9_-]{43}$/);
	assert.notEqual(body.shareToken, TOKEN_A);
	assert.deepEqual(Object.keys(body), ['shareToken']);

	assert.deepEqual((await post(`/usuario/verificar/${TOKEN_A}`)).body, { existe: false });
	assert.equal((await post(`/usuario/verificar/${body.shareToken}`)).body.existe, true);
	assert.equal((await post(`/usuario/verificar/${TOKEN_B}`)).body.existe, true);

	const rotated = audits.filter(a => a.action === 'passport.share_rotated');
	assert.equal(rotated.length, 1);
	assert.equal(rotated[0].actorId, A);
	assert.equal(rotated[0].target, '1001');
	assert.equal(rotated[0].outcome, 'success');
	const text = JSON.stringify(rotated[0]);
	assert.ok(!text.includes(TOKEN_A) && !text.includes(body.shareToken));
});

test('changing the link needs the CSRF header', async () => {
	const { status } = await post('/usuario/me/enlace', { cookie: cookieFor(A) });
	assert.equal(status, 403);
	assert.equal(usuarios[0].shareToken, TOKEN_A);
});

test('a passport that is not accepted cannot change its link', async () => {
	const old = usuarios[2].shareToken;
	const { status } = await post('/usuario/me/enlace', { cookie: cookieFor(C), headers: { 'x-csrf-token': csrf } });
	assert.equal(status, 409);
	assert.equal(usuarios[2].shareToken, old);
	assert.equal(audits.filter(a => a.action === 'passport.share_rotated').length, 0);
});

test('changing the link has its own tight rate limit per account', async () => {
	const statuses = [];
	for (let i = 0; i < 6; i++) {
		statuses.push((await post('/usuario/me/enlace', { cookie: cookieFor(B), headers: { 'x-csrf-token': csrf } })).status);
	}
	assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
	assert.equal(statuses[5], 429);
});
