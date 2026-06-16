const { test } = require('node:test');
const assert = require('node:assert');

const schemas = require('../validation/schemas');
const identity = require('../validation/identity');

// A complete, valid application used as a base; individual tests mutate one field.
const validApplication = (overrides = {}) => ({
	nombre: 'María',
	apellidos: 'García López',
	paisResidencia: 'España',
	localidadResidencia: 'Madrid',
	lugarNacimiento: 'Sevilla',
	tipoDocumento: 'dni',
	numeroDocumento: '12345678Z',
	fechaNacimiento: '2010-05-01',
	correoElectronico: 'Maria@Example.com',
	numeroTelefono: '600123123',
	diagnostico: { dislexia: true, discalculia: false, disortografía: false, dispraxia: false, tdah: false },
	aceptoSolicitud: true,
	...overrides,
});

// --- Identity validators -----------------------------------------------------

test('isValidDni accepts a correct check letter and rejects a wrong one', () => {
	assert.equal(identity.isValidDni('12345678Z'), true);
	assert.equal(identity.isValidDni('12345678A'), false);
	assert.equal(identity.isValidDni('1234567Z'), false); // too short
});

test('isValidNie validates X/Y/Z prefixed documents', () => {
	assert.equal(identity.isValidNie('X1234567L'), true);
	assert.equal(identity.isValidNie('X1234567Z'), false);
});

test('isValidDocumento applies the Spanish checksum only for Spain', () => {
	assert.equal(identity.isValidDocumento('dni', '12345678Z', 'España'), true);
	assert.equal(identity.isValidDocumento('dni', '12345678A', 'España'), false);
	assert.equal(identity.isValidDocumento('pasaporte', 'AB123456', 'España'), true);
	assert.equal(identity.isValidDocumento('dni', '', 'España'), false);
	// Non-Spanish documents (Argentine DNI has no check letter) are accepted as-is.
	assert.equal(identity.isValidDocumento('dni', '45570422', 'Argentina'), true);
	assert.equal(identity.isValidDocumento('dni', '12345678A', 'Argentina'), true);
	assert.equal(identity.isValidDocumento('dni', '', 'Argentina'), false);
});

test('normalizePhone canonicalises to E.164 and rejects nonsense', () => {
	assert.equal(identity.normalizePhone('600123123'), '+34600123123');
	assert.equal(identity.normalizePhone('600 12 31 23'), '+34600123123');
	assert.equal(identity.normalizePhone('+34600123123'), '+34600123123');
	assert.equal(identity.normalizePhone('123'), null);
	assert.equal(identity.normalizePhone(''), null);
});

test('suggestEmail catches near-miss domains only', () => {
	assert.equal(identity.suggestEmail('juan@gmial.com'), 'juan@gmail.com');
	assert.equal(identity.suggestEmail('juan@hotnail.com'), 'juan@hotmail.com');
	assert.equal(identity.suggestEmail('juan@gmail.com'), null);
	assert.equal(identity.suggestEmail('juan@miempresa.es'), null);
});

// --- Draft / autosave schemas ------------------------------------------------

test('draftStartSchema needs only email + password', () => {
	assert.equal(schemas.draftStartSchema.safeParse({ correoElectronico: 'a@b.com', password: 'password1' }).success, true);
	assert.equal(schemas.draftStartSchema.safeParse({ correoElectronico: 'a@b.com', password: 'short' }).success, false);
});

test('draftPatchSchema accepts a partial step and normalizes phone', () => {
	const r = schemas.draftPatchSchema.safeParse({ nombre: 'Ana', numeroTelefono: '600123123' });
	assert.equal(r.success, true);
	assert.equal(r.data.numeroTelefono, '+34600123123');
});

test('draftPatchSchema rejects an invalid phone even on autosave', () => {
	assert.equal(schemas.draftPatchSchema.safeParse({ numeroTelefono: '123' }).success, false);
});

// --- Submit schema -----------------------------------------------------------

test('submitSchema accepts a complete application and normalizes contact fields', () => {
	const r = schemas.submitSchema.safeParse(validApplication());
	assert.equal(r.success, true);
	assert.equal(r.data.numeroTelefono, '+34600123123');
	assert.equal(r.data.correoElectronico, 'maria@example.com'); // lowercased
});

test('submitSchema requires at least one diagnosis', () => {
	const blank = validApplication({
		diagnostico: { dislexia: false, discalculia: false, disortografía: false, dispraxia: false, tdah: false },
	});
	assert.equal(schemas.submitSchema.safeParse(blank).success, false);

	const one = validApplication({
		diagnostico: { dislexia: false, discalculia: true, disortografía: false, dispraxia: false, tdah: false },
	});
	assert.equal(schemas.submitSchema.safeParse(one).success, true);
});

test('submitSchema requires the privacy consent', () => {
	assert.equal(schemas.submitSchema.safeParse(validApplication({ aceptoSolicitud: false })).success, false);
});

test('submitSchema enforces the DNI checksum only for Spain', () => {
	// Spain: wrong check letter is rejected.
	assert.equal(schemas.submitSchema.safeParse(validApplication({ numeroDocumento: '12345678A' })).success, false);
	// Argentina: a letterless numeric DNI is accepted.
	const argentino = validApplication({ paisResidencia: 'Argentina', numeroDocumento: '45570422' });
	assert.equal(schemas.submitSchema.safeParse(argentino).success, true);
});

test('submitSchema requires guardian details when esTutor is set', () => {
	assert.equal(schemas.submitSchema.safeParse(validApplication({ esTutor: true })).success, false);
	const withTutor = validApplication({ esTutor: true, tutorNombre: 'Luis', tutorApellidos: 'García' });
	assert.equal(schemas.submitSchema.safeParse(withTutor).success, true);
});
