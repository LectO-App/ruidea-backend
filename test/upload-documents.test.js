const { test, before, after } = require('node:test');
const assert = require('node:assert');

// POST /inscripcion/subir-archivos against in-memory stand-ins for Prisma and Azure storage.
// All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const rows = [];
const fake = {
	usuario: {
		findUnique: async ({ where }) => rows.find(r => r.id === where.id) || null,
		update: async ({ where, data }) => {
			const row = rows.find(r => r.id === where.id);
			Object.assign(row, data);
			return row;
		},
	},
	auditLog: { create: async () => ({}) },
};
require('../db/prisma').getPrisma = () => fake;

const blobs = new Map();
const uploads = [];
require('azure-storage').createBlobService = () => ({
	createBlockBlobFromStream(container, name, stream, length, options, cb) {
		const chunks = [];
		stream.on('data', chunk => chunks.push(chunk));
		stream.on('end', () => {
			blobs.set(name, Buffer.concat(chunks));
			uploads.push({ name, options });
			cb(null);
		});
	},
	getBlobToStream(container, name, sink, cb) {
		sink.end(blobs.get(name), () => cb(null));
	},
	deleteBlobIfExists(container, name, options, cb) {
		cb(null, blobs.delete(name));
	},
});

const express = require('express');
const cookieParser = require('cookie-parser');
const fileUpload = require('express-fileupload');
const { PDFDocument } = require('pdf-lib');
const { Jimp } = require('jimp');
const { signToken } = require('../functions/tokens');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const csrf = 'test-csrf';
const cookie = `token=${signToken({ id: A, role: 'user', csrf, tv: 0 }, { expiresIn: '1h' })}`;

let server;
let base;
before(async () => {
	const app = express();
	app.use(cookieParser());
	app.use(express.json());
	app.use(fileUpload());
	app.use('/inscripcion', require('../routes/inscripcion'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const reset = archivoBlob => {
	rows.splice(0, rows.length, { id: A, estado: 'pendiente', archivoBlob, tokenVersion: 0 });
	blobs.clear();
	uploads.length = 0;
	if (archivoBlob) blobs.set(archivoBlob, Buffer.from('previous'));
};

const pdfWithPages = async (...sizes) => {
	const doc = await PDFDocument.create();
	for (const size of sizes) doc.addPage([size, size]);
	return Buffer.from(await doc.save());
};

const send = (files, fields = {}) => {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	files.forEach(({ name, type, data }, i) => form.append(`Archivo N${i}`, new Blob([data], { type }), name));
	return fetch(`${base}/inscripcion/subir-archivos`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf }, body: form });
};

const pageSizes = async bytes => (await PDFDocument.load(bytes)).getPages().map(page => Math.round(page.getSize().width));

test('several files are stored as one inline PDF in the order sent, and the old ZIP is deleted', async () => {
	reset(`${A}/2026-01-01T00:00:00.000Z.zip`);
	const photo = await new Jimp({ width: 30, height: 40, color: 0xffcc00ff }).getBuffer('image/png');
	const res = await send([
		{ name: 'b.pdf', type: 'application/pdf', data: await pdfWithPages(300) },
		{ name: 'foto.png', type: 'image/png', data: photo },
		{ name: 'a.pdf', type: 'application/pdf', data: await pdfWithPages(100) },
	]);
	assert.equal(res.status, 200);
	const { archivoBlob } = rows[0];
	assert.match(archivoBlob, new RegExp(`^${A}/.+\\.pdf$`));
	assert.deepStrictEqual([...blobs.keys()], [archivoBlob]);
	assert.deepStrictEqual(uploads[0].options.contentSettings, { contentType: 'application/pdf', contentDisposition: 'inline' });
	assert.deepStrictEqual(await pageSizes(blobs.get(archivoBlob)), [300, 595, 100]);
});

test('agregar puts the new files after the pages of the current PDF and deletes the old one', async () => {
	reset('');
	const current = `${A}/2026-01-01T00:00:00.000Z.pdf`;
	rows[0].archivoBlob = current;
	blobs.set(current, await pdfWithPages(111, 222));
	const res = await send([{ name: 'nuevo.pdf', type: 'application/pdf', data: await pdfWithPages(333) }], { modo: 'agregar' });
	assert.equal(res.status, 200);
	assert.notEqual(rows[0].archivoBlob, current);
	assert.equal(blobs.has(current), false);
	assert.deepStrictEqual(await pageSizes(blobs.get(rows[0].archivoBlob)), [111, 222, 333]);
});

test('reemplazar leaves out the pages of the current PDF', async () => {
	reset('');
	rows[0].archivoBlob = `${A}/2026-01-01T00:00:00.000Z.pdf`;
	blobs.set(rows[0].archivoBlob, await pdfWithPages(111));
	const res = await send([{ name: 'nuevo.pdf', type: 'application/pdf', data: await pdfWithPages(333) }], { modo: 'reemplazar' });
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await pageSizes(blobs.get(rows[0].archivoBlob)), [333]);
});

test('agregar to an old ZIP is refused and keeps the ZIP', async () => {
	const zip = `${A}/2026-01-01T00:00:00.000Z.zip`;
	reset(zip);
	const res = await send([{ name: 'nuevo.pdf', type: 'application/pdf', data: await pdfWithPages(333) }], { modo: 'agregar' });
	assert.equal(res.status, 409);
	assert.match((await res.json()).message, /Reemplazar/);
	assert.equal(rows[0].archivoBlob, zip);
	assert.deepStrictEqual([...blobs.keys()], [zip]);
});

test('a file that cannot be added is named in the answer and nothing is stored', async () => {
	const zip = `${A}/2026-01-01T00:00:00.000Z.zip`;
	reset(zip);
	const res = await send([
		{ name: 'bien.pdf', type: 'application/pdf', data: await pdfWithPages(300) },
		{ name: 'foto rota.jpg', type: 'image/jpeg', data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]) },
	]);
	assert.equal(res.status, 422);
	assert.match((await res.json()).message, /«foto rota\.jpg»/);
	assert.equal(rows[0].archivoBlob, zip);
	assert.equal(uploads.length, 0);
});

test('an unknown modo is refused', async () => {
	reset('');
	const res = await send([{ name: 'a.pdf', type: 'application/pdf', data: await pdfWithPages(100) }], { modo: 'mezclar' });
	assert.equal(res.status, 400);
	assert.equal(uploads.length, 0);
});
