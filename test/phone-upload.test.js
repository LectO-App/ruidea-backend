const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// "Hazles una foto con el móvil" (routes/movil.js) and the join of phone photos into the
// documents PDF (routes/inscripcion.js), against in-memory stand-ins for Prisma, Azure
// storage and nodemailer. All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

// A small matcher for the Prisma `where` shapes these routes use.
const matches = (row, where = {}) =>
	Object.entries(where).every(([key, cond]) => {
		if (key === 'OR') return cond.some(c => matches(row, c));
		if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
			if ('in' in cond) return cond.in.includes(row[key]);
			if ('lte' in cond) return row[key] <= cond.lte;
			if ('lt' in cond) return row[key] < cond.lt;
			if ('gt' in cond) return row[key] > cond.gt;
			if ('not' in cond) return row[key] !== cond.not && row[key] != null;
		}
		return row[key] === cond;
	});

const table = (rows, uniqueKeys = []) => ({
	rows,
	findUnique: async ({ where }) => rows.find(r => matches(r, where)) || null,
	findFirst: async ({ where, orderBy }) => {
		const found = rows.filter(r => matches(r, where));
		if (orderBy && orderBy.orden === 'desc') found.sort((x, y) => y.orden - x.orden);
		return found[0] || null;
	},
	findMany: async ({ where } = {}) => rows.filter(r => matches(r, where)).sort((x, y) => (x.orden || 0) - (y.orden || 0)),
	count: async ({ where }) => rows.filter(r => matches(r, where)).length,
	create: async ({ data }) => {
		for (const key of uniqueKeys) {
			if (data[key] != null && rows.some(r => r[key] === data[key])) throw Object.assign(new Error('unique'), { code: 'P2002' });
		}
		const row = { conectadoEn: null, creadoEn: new Date(), ...data };
		rows.push(row);
		return row;
	},
	update: async ({ where, data }) => {
		const row = rows.find(r => matches(r, where));
		Object.assign(row, data);
		return row;
	},
	updateMany: async ({ where, data }) => {
		const found = rows.filter(r => matches(r, where));
		found.forEach(r => Object.assign(r, data));
		return { count: found.length };
	},
	deleteMany: async ({ where }) => {
		const before = rows.length;
		for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
		return { count: before - rows.length };
	},
});

const audits = [];
const fake = {
	usuario: table([]),
	phoneToken: table([], ['id', 'codigo']),
	stagedFile: table([]),
	auditLog: { create: async ({ data }) => audits.push(data) },
};
require('../db/prisma').getPrisma = () => fake;
require('nodemailer').createTransport = () => ({ sendMail: async () => ({}) });

const blobs = new Map();
require('azure-storage').createBlobService = () => ({
	createBlockBlobFromStream(container, name, stream, length, options, cb) {
		const chunks = [];
		stream.on('data', chunk => chunks.push(chunk));
		stream.on('end', () => {
			blobs.set(name, { data: Buffer.concat(chunks), type: options.contentSettings.contentType });
			cb(null);
		});
	},
	getBlobToStream(container, name, sink, cb) {
		sink.end(blobs.get(name).data, () => cb(null));
	},
	deleteBlobIfExists(container, name, options, cb) {
		cb(null, blobs.delete(name));
	},
	generateSharedAccessSignature: () => 'sig',
	getUrl: (container, name, sas) => `https://storage.test/${container}/${name}?${sas}`,
});

const express = require('express');
const cookieParser = require('cookie-parser');
const { PDFDocument } = require('pdf-lib');
const { Jimp } = require('jimp');
const { signToken } = require('../functions/tokens');
const { documentUpload } = require('../middlewares/upload');
const phone = require('../functions/phoneUpload');

const csrf = 'test-csrf';
const sessionOf = (id, role = 'user') => `token=${signToken({ id, role, csrf, tv: 0 }, { expiresIn: '1h' })}`;
const asA = { cookie: sessionOf(A), 'x-csrf-token': csrf };
const asB = { cookie: sessionOf(B), 'x-csrf-token': csrf };
const asAdmin = { cookie: sessionOf(null, 'admin'), 'x-csrf-token': csrf };

let server;
let base;
before(async () => {
	const app = express();
	app.use(cookieParser());
	app.use(express.json());
	app.use(documentUpload);
	app.use('/inscripcion', require('../routes/inscripcion'));
	app.use('/movil', require('../routes/movil'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

beforeEach(() => {
	fake.usuario.rows.splice(0, Infinity, { id: A, estado: 'borrador', archivoBlob: '', tokenVersion: 0 }, { id: B, estado: 'borrador', archivoBlob: '', tokenVersion: 0 });
	fake.phoneToken.rows.length = 0;
	fake.stagedFile.rows.length = 0;
	blobs.clear();
	audits.length = 0;
});

const call = (path, { method = 'GET', headers = {}, body } = {}) =>
	fetch(`${base}${path}`, {
		method,
		headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json', ...headers } : headers,
		body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
	});

const newLink = async (headers = asA) => (await call('/movil/token', { method: 'POST', headers })).json();

// A photo whose width marks its page in the joined PDF (portrait photos get an A4 page, so
// the width is read from the embedded image instead: see pageMarks).
const jpeg = width => new Jimp({ width, height: 400, color: 0x3366ccff }).getBuffer('image/jpeg');
const pdfWithPages = async (...sizes) => {
	const doc = await PDFDocument.create();
	for (const size of sizes) doc.addPage([size, size]);
	return Buffer.from(await doc.save());
};
const pageSizes = async bytes => (await PDFDocument.load(bytes)).getPages().map(page => Math.round(page.getSize().width));

const sendPhoto = (token, { grupo = 'diagnostico', data, type = 'image/jpeg', name = 'foto.jpg' } = {}) => {
	const form = new FormData();
	if (grupo) form.append('grupo', grupo);
	if (data) form.append('foto', new Blob([data], { type }), name);
	return call(`/movil/sesion/${token}/fotos`, { method: 'POST', body: form });
};

test('a link is unguessable, has a 6-digit code, expires in 15 minutes and is audited without file data', async () => {
	const res = await call('/movil/token', { method: 'POST', headers: asA });
	assert.equal(res.status, 201);
	const link = await res.json();
	assert.match(link.token, /^[A-Za-z0-9_-]{43}$/);
	assert.match(link.codigo, /^\d{6}$/);
	const minutes = (new Date(link.caduca) - Date.now()) / 60000;
	assert.ok(minutes > 14.9 && minutes <= 15, String(minutes));
	assert.equal(fake.phoneToken.rows[0].usuarioId, A);
	assert.notEqual(fake.phoneToken.rows[0].id, link.token, 'only a hash of the token is stored');
	assert.deepStrictEqual(audits.map(a => [a.action, a.target]), [['phone.token_create', A]]);
});

test('the record comes from the session: a body naming another record is ignored, and admins get none', async () => {
	await call('/movil/token', { method: 'POST', headers: asA, body: { usuarioId: B, id: B } });
	assert.equal(fake.phoneToken.rows[0].usuarioId, A);
	assert.equal((await call('/movil/token', { method: 'POST', headers: asAdmin })).status, 403);
	assert.equal((await call('/movil/token', { method: 'POST' })).status, 401);
});

test('a photo sent with the link is staged under the record folder, with its real type', async () => {
	const { token } = await newLink();
	const res = await sendPhoto(token, { grupo: 'documento', data: await jpeg(300), type: 'image/png' });
	assert.equal(res.status, 201);
	const { fotos } = await res.json();
	assert.equal(fotos.length, 1);
	assert.deepStrictEqual(Object.keys(fotos[0]).sort(), ['grupo', 'id', 'orden']);
	const [row] = fake.stagedFile.rows;
	assert.equal(row.usuarioId, A);
	assert.equal(row.grupo, 'documento');
	assert.match(row.blob, new RegExp(`^${A}/movil/[0-9a-f]{24}\\.jpeg$`));
	assert.equal(blobs.get(row.blob).type, 'image/jpeg');
	const upload = audits.find(a => a.action === 'phone.upload');
	assert.deepStrictEqual(upload.meta, { archivos: 1 });
	assert.equal(JSON.stringify(upload).includes('foto.jpg'), false);
});

test('an expired, unknown or replaced link answers 410 with a fixed message, and stores nothing', async () => {
	const first = await newLink();
	const second = await newLink();
	const photo = await jpeg(300);
	for (const token of [first.token, 'x'.repeat(43), 'short']) {
		const res = await sendPhoto(token, { data: photo });
		assert.equal(res.status, 410, token);
		assert.deepStrictEqual(await res.json(), { message: 'Este enlace ha caducado. Pide un código nuevo en el ordenador.' });
	}
	fake.phoneToken.rows.find(r => r.usuarioId === A).caduca = new Date(Date.now() - 1000);
	assert.equal((await sendPhoto(second.token, { data: photo })).status, 410);
	assert.equal((await call(`/movil/sesion/${second.token}`)).status, 410);
	assert.equal(fake.stagedFile.rows.length, 0);
	assert.equal(blobs.size, 0);
});

test('the code works once, for a link of its own, and a wrong code is refused', async () => {
	const link = await newLink();
	const wrong = String((Number(link.codigo) + 1) % 1000000).padStart(6, '0');
	const refused = await call('/movil/codigo', { method: 'POST', body: { codigo: wrong } });
	assert.equal(refused.status, 404);

	const res = await call('/movil/codigo', { method: 'POST', body: { codigo: `${link.codigo.slice(0, 3)} ${link.codigo.slice(3)}` } });
	assert.equal(res.status, 200);
	const { token } = await res.json();
	assert.match(token, /^[A-Za-z0-9_-]{43}$/);
	assert.notEqual(token, link.token);
	assert.equal((await sendPhoto(token, { data: await jpeg(300) })).status, 201);
	assert.equal(fake.stagedFile.rows[0].usuarioId, A);

	assert.equal((await call('/movil/codigo', { method: 'POST', body: { codigo: link.codigo } })).status, 404);
	assert.equal((await call('/movil/codigo', { method: 'POST', body: { codigo: 'abcdef' } })).status, 400);
});

test('an expired code is refused', async () => {
	const link = await newLink();
	fake.phoneToken.rows[0].caduca = new Date(Date.now() - 1000);
	assert.equal((await call('/movil/codigo', { method: 'POST', body: { codigo: link.codigo } })).status, 404);
});

test('the phone page answer carries the expiry only, and marks the phone as connected', async () => {
	const { token } = await newLink();
	let list = await (await call('/movil/archivos', { headers: asA })).json();
	assert.equal(list.movilConectado, false);
	const res = await call(`/movil/sesion/${token}`);
	assert.equal(res.status, 200);
	assert.deepStrictEqual(Object.keys(await res.json()), ['caduca']);
	list = await (await call('/movil/archivos', { headers: asA })).json();
	assert.equal(list.movilConectado, true);
});

test('the phone upload takes the same types as the upload route and checks the bytes', async () => {
	const { token } = await newLink();
	const text = await sendPhoto(token, { data: Buffer.from('hola, no soy una foto'), type: 'text/plain', name: 'nota.txt' });
	assert.equal(text.status, 400);
	assert.match((await text.json()).message, /Solo se permiten/);
	const disguised = await sendPhoto(token, { data: Buffer.from('hola, no soy una foto'), type: 'image/jpeg' });
	assert.equal(disguised.status, 400);
	assert.equal((await sendPhoto(token, { data: await pdfWithPages(200), type: 'application/pdf', name: 'a.pdf' })).status, 201);
	assert.equal((await sendPhoto(token, { grupo: 'otro', data: await jpeg(300) })).status, 400);
	assert.equal((await sendPhoto(token, { grupo: null, data: await jpeg(300) })).status, 400);
	assert.equal((await sendPhoto(token, {})).status, 400);
	assert.equal(fake.stagedFile.rows.length, 1);
});

test('a photo over 25 MB answers 413', async () => {
	const { token } = await newLink();
	const big = Buffer.alloc(26 * 1024 * 1024);
	big[0] = 0xff;
	big[1] = 0xd8;
	big[2] = 0xff;
	const res = await sendPhoto(token, { data: big });
	assert.equal(res.status, 413);
	assert.equal(fake.stagedFile.rows.length, 0);
});

test('no more than 10 staged files per record', async () => {
	const { token } = await newLink();
	const photo = await jpeg(300);
	for (let i = 0; i < 10; i++) assert.equal((await sendPhoto(token, { data: photo })).status, 201);
	const res = await sendPhoto(token, { data: photo });
	assert.equal(res.status, 400);
	assert.match((await res.json()).message, /10 archivos/);
	assert.deepStrictEqual(fake.stagedFile.rows.map(r => r.orden), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('only the owner lists and deletes staged files', async () => {
	const { token } = await newLink();
	await sendPhoto(token, { grupo: 'documento', data: await jpeg(300) });
	await sendPhoto(token, { grupo: 'diagnostico', data: await jpeg(300) });

	const res = await call('/movil/archivos', { headers: asA });
	assert.equal(res.status, 200);
	const { archivos } = await res.json();
	assert.deepStrictEqual(archivos.map(f => f.grupo), ['diagnostico', 'documento']);
	assert.deepStrictEqual(Object.keys(archivos[0]).sort(), ['creado', 'grupo', 'id', 'orden', 'tamano', 'tipo', 'url']);
	assert.match(archivos[0].url, /\/movil\/.+\?sig$/);

	assert.deepStrictEqual((await (await call('/movil/archivos', { headers: asB })).json()).archivos, []);
	assert.equal((await call('/movil/archivos', { headers: asAdmin })).status, 403);
	assert.equal((await call('/movil/archivos')).status, 401);

	const id = archivos[0].id;
	assert.equal((await call(`/movil/archivos/${id}`, { method: 'DELETE', headers: asB })).status, 404);
	assert.equal((await call(`/movil/archivos/${id}`, { method: 'DELETE', headers: asAdmin })).status, 403);
	assert.equal(fake.stagedFile.rows.length, 2);
	assert.equal((await call(`/movil/archivos/${id}`, { method: 'DELETE', headers: asA })).status, 200);
	assert.equal(fake.stagedFile.rows.length, 1);
	assert.equal(blobs.size, 1);
});

// Each photo gets its own page; a square PDF page keeps its size. Photos are told apart by the
// width of their page: wider than tall gives a landscape A4 page (842), taller a portrait one (595).
const uploadWith = (files, fields = {}, headers = asA) => {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	for (const { field, name, type, data } of files) form.append(field, new Blob([data], { type }), name);
	return call('/inscripcion/subir-archivos', { method: 'POST', headers, body: form });
};

test('the upload joins local files and phone photos in the order chosen, then deletes the staged photos', async () => {
	const { token } = await newLink();
	await sendPhoto(token, { grupo: 'diagnostico', data: await new Jimp({ width: 600, height: 300, color: 0x00ff00ff }).getBuffer('image/jpeg') });
	await sendPhoto(token, { grupo: 'documento', data: await new Jimp({ width: 300, height: 600, color: 0x00ff00ff }).getBuffer('image/jpeg') });
	const [landscape, portrait] = fake.stagedFile.rows;
	const orden = JSON.stringify([
		'archivo:Diagnostico Medico - Archivo N0',
		`movil:${landscape.id}`,
		`movil:${portrait.id}`,
		'archivo:Documento Identidad - Archivo N0',
	]);
	const res = await uploadWith(
		[
			{ field: 'Documento Identidad - Archivo N0', name: 'dni.pdf', type: 'application/pdf', data: await pdfWithPages(222) },
			{ field: 'Diagnostico Medico - Archivo N0', name: 'informe.pdf', type: 'application/pdf', data: await pdfWithPages(111) },
		],
		{ orden }
	);
	assert.equal(res.status, 200);
	assert.equal((await res.json()).archivos, 4);
	const { archivoBlob } = fake.usuario.rows[0];
	assert.deepStrictEqual(await pageSizes(blobs.get(archivoBlob).data), [111, 842, 595, 222]);
	assert.equal(fake.stagedFile.rows.length, 0);
	assert.deepStrictEqual([...blobs.keys()], [archivoBlob]);
	assert.deepStrictEqual(audits.find(a => a.action === 'docs.upload').meta, { archivos: 4, movil: 2 });
});

test('phone photos alone can be the upload, and ones left out of the order go last', async () => {
	const { token } = await newLink();
	await sendPhoto(token, { data: await new Jimp({ width: 600, height: 300 }).getBuffer('image/jpeg') });
	const res = await uploadWith([{ field: 'Diagnostico Medico - Archivo N0', name: 'a.pdf', type: 'application/pdf', data: await pdfWithPages(111) }]);
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await pageSizes(blobs.get(fake.usuario.rows[0].archivoBlob).data), [111, 842]);

	await sendPhoto(token, { data: await new Jimp({ width: 300, height: 600 }).getBuffer('image/jpeg') });
	fake.usuario.rows[0].estado = 'aceptado';
	const only = await uploadWith([], { modo: 'agregar' });
	assert.equal(only.status, 200);
	assert.deepStrictEqual(await pageSizes(blobs.get(fake.usuario.rows[0].archivoBlob).data), [111, 842, 595]);
	assert.equal(fake.usuario.rows[0].estado, 'pendiente');
});

test('an upload with no files and no phone photos is refused', async () => {
	assert.equal((await uploadWith([])).status, 400);
});

test('local files and phone photos count together against the limit of 10', async () => {
	const { token } = await newLink();
	const photo = await jpeg(300);
	for (let i = 0; i < 8; i++) await sendPhoto(token, { data: photo });
	const pdf = await pdfWithPages(100);
	const files = [0, 1, 2].map(i => ({ field: `Documento Identidad - Archivo N${i}`, name: `${i}.pdf`, type: 'application/pdf', data: pdf }));
	const res = await uploadWith(files);
	assert.equal(res.status, 400);
	assert.equal(fake.stagedFile.rows.length, 8);
});

test('another person\'s phone photo cannot be named in the order', async () => {
	const linkB = await newLink(asB);
	await sendPhoto(linkB.token, { data: await jpeg(300) });
	const [photoB] = fake.stagedFile.rows;
	const res = await uploadWith([{ field: 'Diagnostico Medico - Archivo N0', name: 'a.pdf', type: 'application/pdf', data: await pdfWithPages(111) }], {
		orden: JSON.stringify([`movil:${photoB.id}`, 'archivo:Diagnostico Medico - Archivo N0']),
	});
	assert.equal(res.status, 200);
	assert.deepStrictEqual(await pageSizes(blobs.get(fake.usuario.rows[0].archivoBlob).data), [111]);
	assert.equal(fake.stagedFile.rows.length, 1);
	assert.equal(fake.stagedFile.rows[0].usuarioId, B);
});

test('sending the application joins the phone photos not uploaded yet', async () => {
	fake.usuario.rows[0] = {
		...fake.usuario.rows[0],
		nombre: 'Ana',
		apellidos: 'Prueba',
		paisResidencia: 'España',
		localidadResidencia: 'Madrid',
		lugarNacimiento: 'Madrid',
		numeroDocumento: 'X1',
		fechaNacimiento: new Date('2000-01-01'),
		correoElectronico: 'ana@example.test',
		numeroTelefono: '+34600123123',
		dislexia: true,
		discalculia: false,
		disortografia: false,
		dispraxia: false,
		tdah: false,
		aceptoSolicitud: true,
	};
	const { token } = await newLink();
	await sendPhoto(token, { data: await jpeg(300) });
	const res = await call(`/inscripcion/${A}/enviar`, { method: 'POST', headers: asA, body: {} });
	assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
	assert.match(fake.usuario.rows[0].archivoBlob, new RegExp(`^${A}/.+\\.pdf$`));
	assert.equal(fake.stagedFile.rows.length, 0);
	assert.equal(fake.usuario.rows[0].estado, 'pendiente');
});

test('the sweep deletes staged photos older than 30 days and expired links', async () => {
	const { token } = await newLink();
	await sendPhoto(token, { data: await jpeg(300) });
	await sendPhoto(token, { data: await jpeg(300) });
	const [old] = fake.stagedFile.rows;
	old.creadoEn = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
	fake.phoneToken.rows[0].caduca = new Date(Date.now() - 1000);
	const summary = await phone.purgeStale();
	assert.deepStrictEqual(summary, { deleted: 1, failed: 0, expiredLinks: 1 });
	assert.equal(fake.stagedFile.rows.length, 1);
	assert.equal(blobs.has(old.blob), false);
	assert.equal(fake.phoneToken.rows.length, 0);
});

test('request logs show the phone link route, not its token', () => {
	const { requestSerializer } = require('../functions/logger');
	const token = 'T'.repeat(43);
	assert.equal(requestSerializer({ url: `/movil/sesion/${token}/fotos` }).url, '/movil/sesion/:token/fotos');
	assert.equal(requestSerializer({ url: `/movil/sesion/${token}` }).url, '/movil/sesion/:token');
});
