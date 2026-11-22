const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { Jimp } = require('jimp');
const heicConvert = require('heic-convert');

// Combines a person's uploads (PDFs and photos) into the one PDF the reviewer opens.
// Pure JS (pdf-lib, Jimp, libheif-js, libwebp as wasm): no native build in the image.

// A4 in PDF points, and the white margin around a photo.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 28;
// Longest side of a photo once embedded: about 240 dpi on A4, legible and a few hundred KB.
const MAX_EDGE = 2000;
const JPEG_QUALITY = 80;

class DocumentFileError extends Error {
	// kind: 'pdf-encrypted' | 'pdf-damaged' | 'image-undecodable' | 'current-pdf'
	constructor(kind, fileName) {
		super(kind);
		this.name = 'DocumentFileError';
		this.kind = kind;
		this.fileName = fileName;
	}
}

// The file's real type from its first bytes; the client's MIME type is only a claim.
const sniff = data => {
	if (data.length < 12) return null;
	if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
	if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
	if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
	if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
	if (data.subarray(4, 8).toString('latin1') === 'ftyp') {
		const brand = data.subarray(8, 12).toString('latin1');
		if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
	}
	return null;
};

let webpDecoder = null;
const decodeWebp = async data => {
	if (!webpDecoder) {
		webpDecoder = (async () => {
			const { default: decode, init } = await import('@jsquash/webp/decode.js');
			const wasmPath = path.join(path.dirname(require.resolve('@jsquash/webp/package.json')), 'codec/dec/webp_dec.wasm');
			await init(await WebAssembly.compile(fs.readFileSync(wasmPath)));
			return decode;
		})();
	}
	const decode = await webpDecoder;
	const bitmap = await decode(new Uint8Array(data).buffer);
	return Jimp.fromBitmap({ data: Buffer.from(bitmap.data.buffer), width: bitmap.width, height: bitmap.height });
};

// Decodes any accepted photo, applies its EXIF rotation, scales it down to MAX_EDGE and
// flattens transparency onto white. Returns a JPEG and its pixel size.
const toJpeg = async (kind, data) => {
	let image;
	if (kind === 'webp') image = await decodeWebp(data);
	else if (kind === 'heic') image = await Jimp.fromBuffer(Buffer.from(await heicConvert({ buffer: data, format: 'JPEG', quality: 0.92 })));
	else image = await Jimp.fromBuffer(data);

	if (Math.max(image.width, image.height) > MAX_EDGE) image.scaleToFit({ w: MAX_EDGE, h: MAX_EDGE });
	if (kind === 'png' || kind === 'webp') {
		image = new Jimp({ width: image.width, height: image.height, color: 0xffffffff }).composite(image, 0, 0);
	}
	const jpeg = await image.getBuffer('image/jpeg', { quality: JPEG_QUALITY });
	return { jpeg, width: image.width, height: image.height };
};

// One A4 page per photo, turned to landscape for a landscape photo, the photo centred
// and fitted inside the margin.
const addImagePage = async (doc, kind, data) => {
	const { jpeg, width, height } = await toJpeg(kind, data);
	const landscape = width > height;
	const pageWidth = landscape ? A4_LONG : A4_SHORT;
	const pageHeight = landscape ? A4_SHORT : A4_LONG;
	const scale = Math.min((pageWidth - 2 * MARGIN) / width, (pageHeight - 2 * MARGIN) / height);
	// A copy: pdf-lib reads the bytes from offset 0 of the backing store, and a small Buffer is
	// a slice of Node's shared pool.
	const embedded = await doc.embedJpg(Uint8Array.from(jpeg));
	const page = doc.addPage([pageWidth, pageHeight]);
	page.drawImage(embedded, {
		x: (pageWidth - width * scale) / 2,
		y: (pageHeight - height * scale) / 2,
		width: width * scale,
		height: height * scale,
	});
};

// The parsed PDF, or null when it cannot be parsed or has no pages.
const readPdf = async data => {
	try {
		const source = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
		return source.getPageCount() > 0 ? source : null;
	} catch {
		return null;
	}
};

// Encrypted pages cannot be copied into another PDF.
const loadPdf = async (data, fileName, damagedKind = 'pdf-damaged') => {
	const source = await readPdf(data);
	if (!source) throw new DocumentFileError(damagedKind, fileName);
	if (source.isEncrypted) throw new DocumentFileError(damagedKind === 'pdf-damaged' ? 'pdf-encrypted' : damagedKind, fileName);
	return source;
};

const appendPdf = async (doc, source, fileName, damagedKind = 'pdf-damaged') => {
	try {
		const pages = await doc.copyPages(source, source.getPageIndices());
		for (const page of pages) doc.addPage(page);
	} catch {
		throw new DocumentFileError(damagedKind, fileName);
	}
};

// files: [{ name, data }] in page order. base: the PDF stored now, when the new files go
// after it. Returns the PDF bytes. A single PDF with no base is returned unchanged.
// Rejects with a DocumentFileError naming the first file that cannot be added.
const combineDocuments = async (files, { base = null } = {}) => {
	const kinds = files.map(file => sniff(file.data));
	if (!base && files.length === 1 && kinds[0] === 'pdf') {
		if (!(await readPdf(files[0].data))) throw new DocumentFileError('pdf-damaged', files[0].name);
		return files[0].data;
	}

	const doc = await PDFDocument.create();
	if (base) await appendPdf(doc, await loadPdf(base, null, 'current-pdf'), null, 'current-pdf');
	for (let i = 0; i < files.length; i++) {
		const { name, data } = files[i];
		const kind = kinds[i];
		if (kind === 'pdf') {
			await appendPdf(doc, await loadPdf(data, name), name);
		} else if (kind) {
			try {
				await addImagePage(doc, kind, data);
			} catch {
				throw new DocumentFileError('image-undecodable', name);
			}
		} else {
			throw new DocumentFileError(files[i].mimetype === 'application/pdf' ? 'pdf-damaged' : 'image-undecodable', name);
		}
	}
	return Buffer.from(await doc.save());
};

// File names come from the person's device: shown back to them, never logged.
const displayName = name =>
	String(name || 'el archivo')
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.slice(0, 80);

const MESSAGES = {
	'pdf-encrypted': name =>
		`«${name}» es un PDF protegido con contraseña y no podemos unirlo a los demás. Sube una copia sin contraseña o una foto del documento.`,
	'pdf-damaged': name =>
		`No hemos podido abrir «${name}». Puede que el PDF esté dañado: prueba a guardarlo otra vez o sube una foto del documento.`,
	'image-undecodable': name =>
		`No hemos podido leer la imagen «${name}». Prueba con otra foto en JPG o PNG.`,
	'current-pdf': () =>
		'No hemos podido abrir el PDF que ya tenías guardado. Elige «Cambiarlos por los nuevos» y sube todos los documentos otra vez.',
};

const errorMessage = err => MESSAGES[err.kind](displayName(err.fileName));

module.exports = { combineDocuments, DocumentFileError, errorMessage, MAX_EDGE };
