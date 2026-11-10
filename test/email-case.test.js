const { test } = require('node:test');
const assert = require('node:assert');

const { planEmails } = require('../scripts/lib/copy-plan');
const { toData, normalizeEmail } = require('../db/usuarioJson');
const schemas = require('../validation/schemas');

// Synthetic rows (only the fields the plan reads).
const u = (id, correoElectronico) => ({ id, correoElectronico });

test('the copy lowercases stored addresses that have capitals or spaces', () => {
	const plan = planEmails([u('a', 'ya.minuscula@example.test'), u('b', 'Mixta.Uno@Example.TEST'), u('c', ' Espacio@example.test')]);
	assert.deepEqual(plan.lowercase, [
		{ id: 'b', to: 'mixta.uno@example.test' },
		{ id: 'c', to: 'espacio@example.test' },
	]);
	assert.deepEqual(plan.collisions, []);
});

test('two users whose addresses differ only in case are detected and left alone', () => {
	const plan = planEmails([
		u('a', 'colision@example.test'),
		u('b', 'Colision@Example.test'),
		u('c', 'DOBLE@example.test'),
		u('d', 'doble@EXAMPLE.test '),
		u('e', 'Sola@Example.test'),
	]);
	assert.deepEqual(plan.collisions, [['a', 'b'], ['c', 'd']]);
	assert.deepEqual(plan.lowercase, [{ id: 'e', to: 'sola@example.test' }]);
});

test('identical addresses are exact duplicates, not case collisions (refused elsewhere)', () => {
	assert.deepEqual(planEmails([u('a', 'x@example.test'), u('b', 'x@example.test')]).collisions, []);
});

test('every write path stores the address lowercased and trimmed', () => {
	const input = '  Mixta.Dos@Example.TEST ';
	const want = 'mixta.dos@example.test';
	const base = {
		nombre: 'Prueba', apellidos: 'Sintética', paisResidencia: 'Argentina', localidadResidencia: 'A', lugarNacimiento: 'B',
		numeroDocumento: '30000001', fechaNacimiento: '2010-01-01', numeroTelefono: '+34600000001',
		diagnostico: { dislexia: true, discalculia: false, disortografía: false, dispraxia: false, tdah: false },
	};
	assert.equal(schemas.draftStartSchema.parse({ correoElectronico: input, password: 'password1' }).correoElectronico, want);
	assert.equal(schemas.registerSchema.parse({ ...base, correoElectronico: input, password: 'password1' }).correoElectronico, want);
	assert.equal(schemas.updateSchema.parse({ ...base, _id: 'x', correoElectronico: input }).correoElectronico, want);
	assert.equal(schemas.modificarSchema.parse({ ...base, id: 'x', correoElectronico: input }).correoElectronico, want);
	assert.equal(schemas.respuestaSchema.parse({ emailUsuario: input, estado: 'aceptado' }).emailUsuario, want);
	assert.equal(schemas.forgotPasswordSchema.parse({ email: input }).email, want);
	// and the data layer normalizes again whatever reaches it
	assert.equal(toData({ correoElectronico: input }).correoElectronico, want);
	assert.equal(normalizeEmail(input), want);
});
