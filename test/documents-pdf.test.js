const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');
const { Jimp } = require('jimp');

const { combineDocuments, DocumentFileError, errorMessage, MAX_EDGE } = require('../functions/documentsPdf');

// All inputs are generated here: blank pages and flat-colour images, no real documents.
const pdfWithPages = async (...sizes) => {
	const doc = await PDFDocument.create();
	for (const size of sizes) doc.addPage([size, size]);
	return Buffer.from(await doc.save({ useObjectStreams: false }));
};

const image = (mime, width, height) => new Jimp({ width, height, color: 0x2a7f62ff }).getBuffer(mime);

const pageSizes = async bytes => {
	const doc = await PDFDocument.load(bytes);
	return doc.getPages().map(page => {
		const { width, height } = page.getSize();
		return [Math.round(width), Math.round(height)];
	});
};

const A4_PORTRAIT = [595, 842];
const A4_LANDSCAPE = [842, 595];

const rejection = async (promise, kind, fileName) => {
	await assert.rejects(promise, err => {
		assert.ok(err instanceof DocumentFileError);
		assert.equal(err.kind, kind);
		assert.equal(err.fileName, fileName);
		return true;
	});
};

test('PDFs and photos become one PDF, in the order sent', async () => {
	const files = [
		{ name: 'informe.pdf', data: await pdfWithPages(200, 300) },
		{ name: 'foto-horizontal.jpg', data: await image('image/jpeg', 400, 300) },
		{ name: 'captura.png', data: await image('image/png', 300, 400) },
		{ name: 'dni.pdf', data: await pdfWithPages(400) },
		{ name: 'foto.webp', data: fs.readFileSync(path.join(__dirname, 'fixtures/landscape.webp')) },
	];
	const pdf = await combineDocuments(files);
	assert.deepStrictEqual(await pageSizes(pdf), [[200, 200], [300, 300], A4_LANDSCAPE, A4_PORTRAIT, [400, 400], A4_LANDSCAPE]);
});

test('a single PDF is stored as it was sent', async () => {
	const data = await pdfWithPages(250);
	const pdf = await combineDocuments([{ name: 'informe.pdf', data }]);
	assert.ok(pdf.equals(data));
});

test('a single photo becomes a one-page PDF', async () => {
	const pdf = await combineDocuments([{ name: 'foto.jpg', data: await image('image/jpeg', 300, 500) }]);
	assert.deepStrictEqual(await pageSizes(pdf), [A4_PORTRAIT]);
});

test('a large phone photo is scaled down so the PDF stays small', async () => {
	const big = await new Jimp({ width: 4000, height: 3000, color: 0x808080ff }).getBuffer('image/png');
	const pdf = await combineDocuments([{ name: 'foto.png', data: big }]);
	const doc = await PDFDocument.load(pdf);
	const images = doc.context
		.enumerateIndirectObjects()
		.map(([, obj]) => obj)
		.filter(obj => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
	assert.equal(images.length, 1);
	assert.equal(images[0].dict.get(PDFName.of('Width')).asNumber(), MAX_EDGE);
	assert.equal(images[0].dict.get(PDFName.of('Height')).asNumber(), 1500);
	assert.ok(pdf.length < 1024 * 1024);
});

test('new files go after the pages of the current PDF', async () => {
	const base = await pdfWithPages(100, 150);
	const pdf = await combineDocuments([{ name: 'nuevo.pdf', data: await pdfWithPages(500) }], { base });
	assert.deepStrictEqual(await pageSizes(pdf), [[100, 100], [150, 150], [500, 500]]);
});

// pdf-lib cannot encrypt; an /Encrypt entry in the trailer is what marks a PDF as encrypted.
const encryptedPdf = async () => {
	const plain = (await pdfWithPages(200)).toString('latin1');
	return Buffer.from(
		plain.replace('trailer\n<<', 'trailer\n<<\n/Encrypt 99 0 R').replace('%%EOF', '99 0 obj\n<< /Filter /Standard /V 1 >>\nendobj\n%%EOF'),
		'latin1'
	);
};

test('a password-protected PDF is rejected by name when it must be joined to other files', async () => {
	const files = [{ name: 'ok.png', data: await image('image/png', 10, 10) }, { name: 'protegido.pdf', data: await encryptedPdf() }];
	await rejection(combineDocuments(files), 'pdf-encrypted', 'protegido.pdf');
});

test('a password-protected PDF sent alone is stored as it was sent', async () => {
	const data = await encryptedPdf();
	assert.ok((await combineDocuments([{ name: 'protegido.pdf', data }])).equals(data));
});

test('a damaged PDF, an undecodable image and an unknown file are rejected by name', async () => {
	const ok = { name: 'ok.pdf', data: await pdfWithPages(200) };
	await rejection(combineDocuments([ok, { name: 'roto.pdf', data: Buffer.from('%PDF-1.7\nnot really a pdf at all') }]), 'pdf-damaged', 'roto.pdf');
	await rejection(combineDocuments([{ name: 'solo.pdf', data: Buffer.from('%PDF-1.7\ngarbage') }]), 'pdf-damaged', 'solo.pdf');
	const brokenJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
	await rejection(combineDocuments([ok, { name: 'foto.jpg', data: brokenJpeg }]), 'image-undecodable', 'foto.jpg');
	const brokenHeic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
	await rejection(combineDocuments([ok, { name: 'foto.heic', data: brokenHeic }]), 'image-undecodable', 'foto.heic');
	await rejection(combineDocuments([ok, { name: 'texto.png', data: Buffer.from('just some text, not an image') }]), 'image-undecodable', 'texto.png');
});

test('a current PDF that cannot be read is reported without blaming a new file', async () => {
	const files = [{ name: 'nuevo.pdf', data: await pdfWithPages(200) }];
	await rejection(combineDocuments(files, { base: Buffer.from('%PDF-1.7\ngarbage') }), 'current-pdf', null);
});

test('the Spanish message names the file and drops control characters', () => {
	const message = errorMessage(new DocumentFileError('pdf-damaged', 'informe\u0007.pdf'));
	assert.match(message, /«informe\.pdf»/);
	assert.match(errorMessage(new DocumentFileError('image-undecodable', 'a.jpg')), /No hemos podido leer la imagen «a\.jpg»/);
});
