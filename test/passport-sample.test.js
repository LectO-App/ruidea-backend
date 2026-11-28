const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// The passport sample of the Revisión step (POST /inscripcion/muestra-pasaporte) and the
// template's sample mode. Prisma and Chrome are faked; all data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const fake = {
	usuario: { findUnique: async ({ where }) => (where.id === A ? { id: A, tokenVersion: 0 } : null) },
	auditLog: { create: async () => ({}) },
};
require('../db/prisma').getPrisma = () => fake;

const rendered = [];
let chromeDown = false;
const browser = require('../functions/browser');
browser.withPage = async fn => {
	if (chromeDown) throw new Error('Failed to launch the browser process');
	return fn({
		setViewport: async () => {},
		setContent: async html => rendered.push(html),
		evaluate: async () => {},
		screenshot: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
		pdf: async () => Buffer.from('%PDF'),
	});
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');
const { passportHtml } = require('../functions/passportTemplate');

const csrf = 'test-csrf';
const cookie = `token=${signToken({ id: A, role: 'user', csrf, tv: 0 }, { expiresIn: '1h' })}`;
const fields = {
	nombre: 'Lucía',
	apellidos: 'Prueba Ejemplo',
	fechaNacimiento: '2012-05-03',
	numeroDocumento: '00000000T',
	paisResidencia: 'España',
};

let server;
let base;
before(async () => {
	const app = express();
	app.use(cookieParser());
	app.use(express.json());
	app.use('/inscripcion', require('../routes/inscripcion'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());
beforeEach(() => {
	rendered.length = 0;
	chromeDown = false;
});

const sample = (body, headers = { cookie, 'x-csrf-token': csrf }) =>
	fetch(`${base}/inscripcion/muestra-pasaporte`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});

test('sample mode has the watermark, a blank number and no QR, even with a share token', async () => {
	const QRCode = require('qrcode');
	const original = QRCode.toDataURL;
	let qrCalls = 0;
	QRCode.toDataURL = async () => {
		qrCalls += 1;
		return 'data:image/png;base64,AA==';
	};
	try {
		const html = await passportHtml({ ...fields, numeroPasaporte: 1042, shareToken: 'T'.repeat(43) }, { sample: true });
		assert.equal(qrCalls, 0);
		assert.ok(html.includes('class="muestra"'));
		assert.ok(html.includes('>MUESTRA<'));
		assert.ok(html.includes('QR al aprobar'));
		assert.equal(html.includes('0001042'), false);
		assert.equal(html.includes('T'.repeat(43)), false);
		assert.ok(html.includes('Pasaporte N° <span>·······</span>'));
	} finally {
		QRCode.toDataURL = original;
	}
});

test('the real passport has no watermark or QR placeholder', async () => {
	const html = await passportHtml({ ...fields, numeroPasaporte: 1042 });
	assert.equal(html.includes('MUESTRA'), false);
	assert.equal(html.includes('QR al aprobar'), false);
	assert.ok(html.includes('0001042'));
});

test('sample mode escapes HTML in the fields', async () => {
	const html = await passportHtml({ ...fields, nombre: '<img src=x onerror=alert(1)>' }, { sample: true });
	assert.equal(html.includes('<img src=x'), false);
	assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('the route renders a JPEG of the sample from the request fields', async () => {
	const res = await sample(fields);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'image/jpeg');
	assert.equal(res.headers.get('cache-control'), 'no-store');
	assert.deepEqual([...Buffer.from(await res.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);
	assert.equal(rendered.length, 1);
	assert.ok(rendered[0].includes('Lucía'));
	assert.ok(rendered[0].includes('03/05/2012'));
	assert.ok(rendered[0].includes('>MUESTRA<'));
});

test('the same fields are served from the render cache', async () => {
	const body = { ...fields, nombre: 'Cache' };
	assert.equal((await sample(body)).status, 200);
	assert.equal((await sample(body)).status, 200);
	assert.equal(rendered.length, 1);
	assert.equal((await sample({ ...body, numeroDocumento: '11111111H' })).status, 200);
	assert.equal(rendered.length, 2);
});

test('fields other than the five on the passport are dropped', async () => {
	const res = await sample({ ...fields, nombre: 'Extra', numeroPasaporte: 77, shareToken: 'S'.repeat(43) });
	assert.equal(res.status, 200);
	assert.equal(rendered[0].includes('0000077'), false);
	assert.equal(rendered[0].includes('S'.repeat(43)), false);
});

test('missing or invalid fields answer 400 and render nothing', async () => {
	for (const body of [
		{ ...fields, nombre: '' },
		{ ...fields, apellidos: undefined },
		{ ...fields, fechaNacimiento: 'no es una fecha' },
		{ ...fields, numeroDocumento: 'x'.repeat(61) },
		{ ...fields, paisResidencia: 42 },
	]) {
		const res = await sample(body);
		assert.equal(res.status, 400);
	}
	assert.equal(rendered.length, 0);
});

test('without a session or the CSRF header the route refuses', async () => {
	assert.equal((await sample(fields, {})).status, 401);
	assert.equal((await sample(fields, { cookie })).status, 403);
	assert.equal(rendered.length, 0);
});

test('when Chrome is unavailable the route answers 503 and logs none of the fields', async () => {
	chromeDown = true;
	const logged = [];
	const app = express();
	app.use(cookieParser());
	app.use(express.json());
	app.use((req, res, next) => {
		req.log = { error: (...args) => logged.push(JSON.stringify(args)), warn: () => {}, info: () => {} };
		next();
	});
	app.use('/inscripcion', require('../routes/inscripcion'));
	const own = await new Promise(resolve => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	try {
		const res = await fetch(`http://127.0.0.1:${own.address().port}/inscripcion/muestra-pasaporte`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
			body: JSON.stringify({ ...fields, nombre: 'SinChrome' }),
		});
		assert.equal(res.status, 503);
		assert.match((await res.json()).message, /muestra/);
		assert.equal(logged.length, 1);
		for (const value of ['SinChrome', 'Prueba Ejemplo', '00000000T', '2012']) assert.equal(logged[0].includes(value), false);
	} finally {
		own.close();
	}
});
