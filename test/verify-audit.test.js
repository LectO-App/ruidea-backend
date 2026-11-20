const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// What verification audits store: country (only from the Pages proxy) and a coarse device
// class, never the IP. In-memory stand-in for the Prisma client; all data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.VERIFY_PASSWORD = 'shared-test-password';

const usuarios = [
	{ id: 'a'.repeat(24), numeroDocumento: '40.111.222', numeroPasaporte: 1001, estado: 'aceptado', shareToken: `${'T'.repeat(42)}0` },
];
const audits = [];
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const fake = {
	usuario: { findFirst: async ({ where }) => usuarios.find(r => matches(r, where)) || null },
	verifier: { findFirst: async () => null, update: async () => ({}) },
	auditLog: { create: async ({ data }) => audits.push(data) },
};
require('../db/prisma').getPrisma = () => fake;

const express = require('express');
let server;
let base;
before(async () => {
	const app = express();
	app.set('trust proxy', 1);
	app.use(require('../middlewares/client-ip').clientIp);
	app.use(express.json());
	app.use('/usuario', require('../routes/usuario'));
	app.use('/admin', require('../routes/admin'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());
beforeEach(() => {
	audits.length = 0;
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const viaPages = { 'cf-worker': 'ruidea.pages.dev', 'cf-connecting-ip': '181.110.103.77', 'x-visitor-country': 'AR' };

const post = async (path, body, headers = {}) => {
	await fetch(base + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body || {}),
	});
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(audits.length, 1);
	return audits[0];
};

test('a QR verification through the Pages proxy stores country and device, not the IP', async () => {
	const audit = await post(`/usuario/verificar/${usuarios[0].shareToken}`, {}, { ...viaPages, 'user-agent': IPHONE });
	assert.equal(audit.action, 'passport.verify_token');
	assert.equal(audit.ip, null);
	assert.deepEqual(audit.meta, { country: 'AR', device: 'mobile' });
});

test('the country header is ignored unless CF-Worker names the Pages project', async () => {
	const forged = await post('/usuario/verificar/40111222/1001', {}, { 'x-visitor-country': 'AR', 'user-agent': WINDOWS });
	assert.equal(forged.action, 'passport.verify_link');
	assert.deepEqual(forged.meta, { country: null, device: 'desktop' });
	assert.equal(forged.ip, null);
	audits.length = 0;
	const other = await post('/usuario/verificar/40111222/1001', {}, { ...viaPages, 'cf-worker': 'evil.example' });
	assert.equal(other.meta.country, null);
});

test('unknown or malformed country codes are stored as null', async () => {
	for (const country of ['XX', 'argentina', 'a', '<b>']) {
		audits.length = 0;
		const audit = await post('/usuario/verificar/40111222/1001', {}, { ...viaPages, 'x-visitor-country': country });
		assert.equal(audit.meta.country, null, country);
	}
});

test('verifier lookups, including denied ones, store country and device without the IP', async () => {
	const ok = await post('/usuario/verificarCheckPassword', { pasaporte: 1001, documento: '40111222', password: 'shared-test-password' }, viaPages);
	assert.equal(ok.action, 'passport.lookup');
	assert.equal(ok.outcome, 'success');
	assert.equal(ok.ip, null);
	assert.deepEqual(ok.meta, { country: 'AR', device: 'other' });
	audits.length = 0;
	const denied = await post('/usuario/verificarCheckPassword', { pasaporte: 1001, documento: '40111222', password: 'wrong' }, viaPages);
	assert.equal(denied.outcome, 'denied');
	assert.equal(denied.ip, null);
	assert.equal(denied.meta.country, 'AR');
});

test('other audit actions keep the IP and no location', async () => {
	const audit = await post('/admin/login', { user: 'nadie', password: 'x' }, viaPages);
	assert.equal(audit.action, 'admin.login');
	assert.equal(audit.ip, '181.110.103.77');
	assert.equal(audit.meta, undefined);
});
