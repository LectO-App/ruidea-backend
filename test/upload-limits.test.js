const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { documentUpload, MAX_FILE_MB, MAX_UPLOAD_MB } = require('../middlewares/upload');

// The upload limits in front of every route, against a stand-in route. All data is synthetic.
const MB = 1024 * 1024;

let server;
let base;
before(async () => {
	const app = express();
	app.use(documentUpload);
	app.post('/subir', (req, res) => res.json({ archivos: Object.keys(req.files || {}).length }));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const send = sizesMb => {
	const form = new FormData();
	sizesMb.forEach((size, i) => form.append(`Archivo N${i}`, new Blob([Buffer.alloc(size * MB)], { type: 'application/pdf' }), `informe${i}.pdf`));
	return fetch(`${base}/subir`, { method: 'POST', body: form });
};

test('the limits are 25 MB per file and 60 MB per upload', () => {
	assert.equal(MAX_FILE_MB, 25);
	assert.equal(MAX_UPLOAD_MB, 60);
});

test('files within both limits reach the route', async () => {
	const res = await send([20, 20]);
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await res.json(), { archivos: 2 });
});

test('a file over 25 MB answers 413 with a Spanish JSON message that names the limit', async () => {
	const res = await send([1, 26]);
	assert.equal(res.status, 413);
	assert.match(res.headers.get('content-type'), /application\/json/);
	const { message } = await res.json();
	assert.match(message, /25 MB/);
	assert.match(message, /menos resolución/);
});

test('an upload over 60 MB in total answers 413 with a JSON message that names the limit', async () => {
	const res = await send([21, 21, 21]);
	assert.equal(res.status, 413);
	const { message } = await res.json();
	assert.match(message, /60 MB/);
});
