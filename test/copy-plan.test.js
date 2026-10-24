const { test } = require('node:test');
const assert = require('node:assert');

const { planPassports } = require('../scripts/lib/copy-plan');

// Synthetic usuario rows in MongoDB insertion order (only the fields the plan reads).
const u = (id, numeroPasaporte, estado = 'aceptado') => ({ id, numeroPasaporte, estado });

test('no duplicates: nothing to do, counter unchanged', () => {
	const plan = planPassports([u('a', 1001), u('b', 1002), u('c', -1, 'borrador'), u('d', -1, 'borrador')], 1002);
	assert.deepEqual(plan, { groups: [], counterSeq: 1002 });
});

test('two accepted holders: the first inserted keeps it, the other gets the next free counter number', () => {
	const rows = [u('a', 1001), u('b', 1002), u('c', 1003), u('d', 1002), u('e', 1005)];
	const plan = planPassports(rows, 1003);
	assert.deepEqual(plan.groups, [{ numero: 1002, keptBy: 'b', reassigned: [{ id: 'd', from: 1002, to: 1004 }] }]);
	assert.equal(plan.counterSeq, 1004);
});

test('an accepted holder keeps the number over an earlier holder that is not accepted', () => {
	const rows = [u('a', 1001, 'pendiente'), u('b', 1001, 'aceptado')];
	const plan = planPassports(rows, 1001);
	assert.equal(plan.groups[0].keptBy, 'b');
	assert.deepEqual(plan.groups[0].reassigned, [{ id: 'a', from: 1001, to: 1002 }]);
});

test('new numbers skip every number already held, across groups', () => {
	const rows = [u('a', 1001), u('b', 1001), u('c', 1001), u('d', 1003), u('e', 1003, 'revision'), u('f', 1005)];
	const plan = planPassports(rows, 1001);
	assert.deepEqual(
		plan.groups.map(g => [g.numero, g.keptBy, g.reassigned.map(r => [r.id, r.to])]),
		[
			[1001, 'a', [['b', 1002], ['c', 1004]]],
			[1003, 'd', [['e', 1006]]],
		]
	);
	assert.equal(plan.counterSeq, 1006);
});

test('without a counter the plan starts above the highest issued number, as the app seeds it', () => {
	const plan = planPassports([u('a', 1500), u('b', 1500), u('c', 1200)], null);
	assert.deepEqual(plan.groups[0].reassigned, [{ id: 'b', from: 1500, to: 1501 }]);
	assert.equal(plan.counterSeq, 1501);
});
