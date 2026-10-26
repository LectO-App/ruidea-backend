const { test } = require('node:test');
const assert = require('node:assert');

// In-memory stand-in for the Azure blob service: only the calls functions/blob.js makes.
// Listing pages hold two names, so the continuation path is exercised too.
const store = new Set();
const fakeService = {
	listBlobsSegmentedWithPrefix(container, prefix, token, cb) {
		const all = [...store].filter(name => name.startsWith(prefix)).sort();
		const start = token ? token.start : 0;
		const entries = all.slice(start, start + 2).map(name => ({ name }));
		cb(null, { entries, continuationToken: start + 2 < all.length ? { start: start + 2 } : null });
	},
	deleteBlobIfExists(container, name, options, cb) {
		cb(null, store.delete(name));
	},
};
require('azure-storage').createBlobService = () => fakeService;

const { deleteUserDocuments } = require('../functions/blob');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const fill = names => {
	store.clear();
	for (const name of names) store.add(name);
};

test('deleting a user removes every upload in its folder, and nothing of anyone else', async () => {
	fill([`${A}/2026-01-01T00:00:00.000Z.zip`, `${A}/2026-02-01T00:00:00.000Z.zip`, `${A}/2026-03-01T00:00:00.000Z.zip`, `${B}/2026-01-01T00:00:00.000Z.zip`]);
	const result = await deleteUserDocuments(A, `${A}/2026-03-01T00:00:00.000Z.zip`);
	assert.deepStrictEqual(result, { deleted: 3, failed: 0, error: null });
	assert.deepStrictEqual([...store], [`${B}/2026-01-01T00:00:00.000Z.zip`]);
});

test('a current zip stored outside the user folder (older naming) is deleted too', async () => {
	fill([`${A}/2026-01-01T00:00:00.000Z.zip`, 'old-name.zip', 'someone-else.zip']);
	const result = await deleteUserDocuments(A, 'old-name.zip');
	assert.equal(result.deleted, 2);
	assert.deepStrictEqual([...store], ['someone-else.zip']);
});

test('a value that is not a record id lists and deletes nothing', async () => {
	fill([`${A}/2026-01-01T00:00:00.000Z.zip`, `${B}/2026-01-01T00:00:00.000Z.zip`]);
	for (const id of ['', 'admin', undefined, null, `${A}/x`, A.toUpperCase()]) {
		const result = await deleteUserDocuments(id, '');
		assert.equal(result.deleted, 0, String(id));
		assert.equal(result.failed, 1, String(id));
	}
	assert.equal(store.size, 2);
});
