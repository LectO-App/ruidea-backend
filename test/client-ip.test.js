const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('node:http');

const { clientIp } = require('../middlewares/client-ip');

// A tiny app with the same trust proxy setting as app.js, answering with req.ip.
const withApp = async (fn) => {
	const app = express();
	app.set('trust proxy', 1);
	app.use(clientIp);
	app.get('/ip', (req, res) => res.json({ ip: req.ip }));
	const server = http.createServer(app).listen(0);
	try {
		await fn(`http://127.0.0.1:${server.address().port}/ip`);
	} finally {
		server.close();
	}
};
const ipFor = async (url, headers) => (await (await fetch(url, { headers })).json()).ip;

// What Container Apps' proxy delivers for a Pages request: XFF "<visitor>, <cloudflare egress>".
const viaPages = { 'x-forwarded-for': '181.110.103.77, 162.158.195.162', 'cf-worker': 'ruidea.pages.dev', 'cf-connecting-ip': '181.110.103.77' };

test('through the Pages proxy req.ip is the visitor (CF-Connecting-IP)', () =>
	withApp(async (url) => assert.equal(await ipFor(url, viaPages), '181.110.103.77')));

test('another Worker zone is ignored: req.ip stays the last proxy hop', () =>
	withApp(async (url) => assert.equal(await ipFor(url, { ...viaPages, 'cf-worker': 'evil.example', 'cf-connecting-ip': '6.6.6.6' }), '162.158.195.162')));

test('no CF-Worker header: unchanged behaviour', () =>
	withApp(async (url) => assert.equal(await ipFor(url, { 'x-forwarded-for': '10.0.0.9, 203.0.113.5', 'cf-connecting-ip': '6.6.6.6' }), '203.0.113.5')));

test('invalid CF-Connecting-IP is ignored', () =>
	withApp(async (url) => assert.equal(await ipFor(url, { ...viaPages, 'cf-connecting-ip': 'not-an-ip' }), '162.158.195.162')));

test('IPv6 visitor is accepted', () =>
	withApp(async (url) => assert.equal(await ipFor(url, { ...viaPages, 'cf-connecting-ip': '2001:db8::1' }), '2001:db8::1')));

test('PAGES_PROXY_WORKER="" turns it off', async () => {
	process.env.PAGES_PROXY_WORKER = '';
	try {
		await withApp(async (url) => assert.equal(await ipFor(url, viaPages), '162.158.195.162'));
	} finally {
		delete process.env.PAGES_PROXY_WORKER;
	}
});
