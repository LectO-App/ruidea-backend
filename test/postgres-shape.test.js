const { test } = require('node:test');
const assert = require('node:assert');

const { rowToJson, jsonToRow, toData } = require('../db/usuarioJson');
const { newObjectId, isValidObjectId, castObjectId, CastError } = require('../db/objectId');
const { requestSerializer } = require('../functions/logger');

// Synthetic record (no real person). Column values as Prisma returns them.
const row = (overrides = {}) => ({
	id: '64b7f0c2a1b2c3d4e5f60718',
	nombre: 'Prueba',
	apellidos: 'Sintética Uno',
	paisResidencia: 'España',
	localidadResidencia: 'Ciudad Ficticia',
	lugarNacimiento: 'Pueblo Ficticio',
	tipoDocumento: 'dni',
	numeroDocumento: '00000000T',
	fechaNacimiento: new Date('2011-02-03T00:00:00.000Z'),
	correoElectronico: 'prueba.uno@example.test',
	numeroTelefono: '+34600000001',
	dislexia: true,
	discalculia: false,
	disortografia: true,
	dispraxia: false,
	tdah: null,
	esTutor: false,
	tutorNombre: '',
	tutorApellidos: '',
	tutorParentesco: '',
	password: 'not-a-real-hash',
	emailVerificado: true,
	fechaCreacion: new Date('2026-01-02T03:04:05.678Z'),
	estado: 'aceptado',
	mensajeMedico: '',
	numeroPasaporte: 1001,
	aceptoRecibirInfo: false,
	aceptoSolicitud: true,
	fechaConsentimiento: null,
	fechaEnvio: null,
	archivoBlob: '',
	extra: null,
	...overrides,
});

test('rowToJson returns the old API shape: _id, nested diagnostico with its accent, no password', () => {
	const json = rowToJson(row());
	assert.equal(json._id, '64b7f0c2a1b2c3d4e5f60718');
	assert.equal('password' in json, false);
	assert.equal('id' in json, false);
	assert.deepEqual(json.diagnostico, { dislexia: true, discalculia: false, disortografía: true, dispraxia: false, tdah: null });
	assert.equal('disortografia' in json, false);
	// defaulted fields stay present when null, as Mongoose returned them
	assert.equal(json.fechaEnvio, null);
	assert.equal(json.fechaConsentimiento, null);
});

test('rowToJson omits unset optional fields, like a Mongoose draft', () => {
	const json = rowToJson(row({ nombre: null, fechaNacimiento: null, fechaCreacion: null }));
	assert.equal('nombre' in json, false);
	assert.equal('fechaNacimiento' in json, false);
	assert.equal('fechaCreacion' in json, false);
});

test('legacy fields and explicit nulls kept in extra come back as before', () => {
	const json = rowToJson(row({ nombre: null, extra: { linkArchivos: '', nombre: null } }));
	assert.equal(json.linkArchivos, '');
	assert.equal(json.nombre, null);
	// a value set later wins over the stored null
	assert.equal(rowToJson(row({ extra: { nombre: null } })).nombre, 'Prueba');
});

test('jsonToRow is the inverse of rowToJson', () => {
	const original = row({ apellidos: null, extra: { linkPasaporte: 'x', apellidos: null } });
	const back = jsonToRow(rowToJson(original), original.password);
	assert.deepEqual(back, original);
});

test('toData mirrors the Mongoose write rules', () => {
	const data = toData({
		correoElectronico: '  Prueba.Dos@Example.TEST ',
		diagnostico: { discalculia: true },
		nombre: undefined,
		fechaCreacion: 1767323045678,
		noEnElEsquema: 'x',
	});
	assert.equal(data.correoElectronico, 'prueba.dos@example.test');
	assert.deepEqual(
		[data.dislexia, data.discalculia, data.disortografia, data.dispraxia, data.tdah],
		[false, true, false, false, false]
	);
	assert.equal('nombre' in data, false);
	assert.equal(data.fechaCreacion.toISOString(), '2026-01-02T03:04:05.678Z');
	assert.equal('noEnElEsquema' in data, false);
});

test('ids keep the ObjectId format', () => {
	const id = newObjectId();
	assert.match(id, /^[0-9a-f]{24}$/);
	assert.notEqual(newObjectId(), id);
	assert.equal(isValidObjectId(id), true);
	assert.equal(isValidObjectId('admin'), false);
	assert.equal(castObjectId('64B7F0C2A1B2C3D4E5F60718'), '64b7f0c2a1b2c3d4e5f60718');
	assert.equal(castObjectId(null), null);
	assert.throws(() => castObjectId('admin'), CastError);
});

test('request logs never carry document numbers, tokens or route params', () => {
	const r = requestSerializer({ url: '/usuario/verificar/00000000T/1001', params: { numeroDocumento: '00000000T' } });
	assert.equal(r.url, '/usuario/verificar/:numeroDocumento/:numeroPasaporte');
	assert.equal('params' in r, false);
	assert.equal(requestSerializer({ url: '/emailVerification/confirm/eyJhbGciOi.x.y' }).url, '/emailVerification/confirm/:token');
	assert.equal(requestSerializer({ url: '/emailVerification/resend' }).url, '/emailVerification/resend');
});
