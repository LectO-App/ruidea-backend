const { test } = require('node:test');
const assert = require('node:assert');

const schemas = require('../validation/schemas');
const { passportHtml } = require('../functions/passportTemplate');

test('verifyCheckSchema rejects NoSQL operator objects', () => {
	const r = schemas.verifyCheckSchema.safeParse({ pasaporte: { $gte: 1001 }, password: 'x' });
	assert.equal(r.success, false);
});

test('verifyCheckSchema coerces numeric strings', () => {
	const r = schemas.verifyCheckSchema.safeParse({ pasaporte: '1001', password: 'x' });
	assert.equal(r.success, true);
	assert.equal(r.data.pasaporte, 1001);
});

test('loginSchema rejects object injection in user field', () => {
	const r = schemas.loginSchema.safeParse({ user: { $ne: null }, password: 'x' });
	assert.equal(r.success, false);
});

test('registerSchema strips unknown server-controlled fields', () => {
	const base = {
		nombre: 'A', apellidos: 'B', paisResidencia: 'X', localidadResidencia: 'Y',
		lugarNacimiento: 'Z', numeroDocumento: '1', fechaNacimiento: '2000-01-01',
		correoElectronico: 'a@b.com', numeroTelefono: '+34600123123', password: 'password1',
		diagnostico: { dislexia: true, discalculia: false, disortografía: false, dispraxia: false, tdah: false },
		estado: 'aceptado', numeroPasaporte: 9999,
	};
	const r = schemas.registerSchema.safeParse(base);
	assert.equal(r.success, true);
	assert.equal('estado' in r.data, false);
	assert.equal('numeroPasaporte' in r.data, false);
});

test('passportHtml escapes HTML in user fields', async () => {
	const html = await passportHtml({
		nombre: '<script>alert(1)</script>', apellidos: 'B', paisResidencia: 'Argentina',
		numeroDocumento: '1', numeroPasaporte: 1001, fechaNacimiento: '2000-01-01',
		diagnostico: { dislexia: true },
	});
	assert.equal(html.includes('<script>alert(1)</script>'), false);
	assert.equal(html.includes('&lt;script&gt;'), true);
});
