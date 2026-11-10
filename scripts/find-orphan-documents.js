// Read-only report of uploaded documents that no record points to any more: zips replaced by
// a re-upload, and folders of deleted users, left behind before routes/inscripcion.js and
// routes/usuario.js deleted them. It deletes nothing and prints only counts, never blob names
// or record ids. Usage: node scripts/find-orphan-documents.js
// (DATABASE_URL and AZURE_STORAGE_CONNECTION_STRING must point at the database and storage.)
require('dotenv/config');
const { getPrisma } = require('../db/prisma');
const { listBlobs, CONTAINER } = require('../functions/blob');

const RECORD_FOLDER = /^([0-9a-f]{24})\//;

(async () => {
	const prisma = getPrisma();
	const users = await prisma.usuario.findMany({ select: { id: true, archivoBlob: true } });
	const ids = new Set(users.map(u => u.id));
	const pointers = new Set(users.map(u => u.archivoBlob).filter(Boolean));

	const names = await listBlobs('');
	const counts = {
		container: CONTAINER,
		records: users.length,
		blobs: names.length,
		// Blobs some record's archivoBlob points to.
		current: 0,
		// Under "<id>/" of an existing record but not its archivoBlob (replaced by a re-upload).
		superseded: 0,
		recordsWithSuperseded: 0,
		// Under "<id>/" where no record has that id (the user was deleted).
		ofDeletedRecords: 0,
		deletedRecordFolders: 0,
		// Not under a record-id folder and not pointed to (older naming). Not attributable here.
		otherNaming: 0,
		// archivoBlob values with no blob behind them.
		missingPointedBlobs: 0,
	};
	const withSuperseded = new Set();
	const deletedFolders = new Set();
	for (const name of names) {
		if (pointers.has(name)) {
			counts.current++;
			continue;
		}
		const match = RECORD_FOLDER.exec(name);
		if (!match) counts.otherNaming++;
		else if (ids.has(match[1])) {
			counts.superseded++;
			withSuperseded.add(match[1]);
		} else {
			counts.ofDeletedRecords++;
			deletedFolders.add(match[1]);
		}
	}
	counts.recordsWithSuperseded = withSuperseded.size;
	counts.deletedRecordFolders = deletedFolders.size;
	const present = new Set(names);
	counts.missingPointedBlobs = [...pointers].filter(name => !present.has(name)).length;

	console.log(JSON.stringify(counts, null, 2));
	await prisma.$disconnect();
})().catch(err => {
	console.error('find-orphan-documents failed:', (err && (err.code || err.name)) || 'unknown');
	process.exit(1);
});
