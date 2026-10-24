// Copies the RUIDEA data from MongoDB into the Postgres database at DATABASE_URL.
//
//   MONGO_URL=mongodb://<restored copy> DATABASE_URL=postgresql://... \
//     node scripts/mongo-to-postgres.js [--replace] [--allow-atlas]
//
// - MONGO_URL must be a restored copy of the data (mongorestore of a dump), never the
//   production cluster. Atlas hosts (mongodb+srv / *.mongodb.net) are refused unless
//   --allow-atlas is given.
// - The Postgres schema must already exist (`npx prisma migrate deploy`).
// - Everything is written in one transaction, in the order counters, verifiers, usuarios,
//   auditlogs. Tables that already hold rows are refused unless --replace is given (then
//   they are emptied inside the same transaction).
// - Ids (ObjectId hex strings), timestamps and password hashes are copied unchanged.
// - Before committing, every usuario is serialized the way the API now does it and compared
//   with what the old Mongoose model returned for the same document; any difference, or a
//   count mismatch, rolls everything back and exits 1.
// - Output is counts and field names only, never record contents.
//
// Needs the dev dependencies (mongoose) and a generated Prisma client; see the PR / README
// for the container command.

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { Prisma } = require('@prisma/client');
const { getPrisma } = require('../db/prisma');
const { FIELDS, DIAGNOSTICO, DATE_FIELDS, KNOWN_KEYS, jsonToRow, rowToJson } = require('../db/usuarioJson');

const USAGE = 'Usage: MONGO_URL=... DATABASE_URL=... node scripts/mongo-to-postgres.js [--replace] [--allow-atlas]';
const BATCH = 500;
const HEX24 = /^[0-9a-f]{24}$/;

// ---------------------------------------------------------------------------------------
// Frozen copy of the Mongoose schemas on master before the migration (models/*.js). Reading
// through them yields exactly what the API returned: defaults filled in, values cast,
// password and __v stripped from JSON.

const stripSensitive = (doc, ret) => {
	delete ret.password;
	delete ret.__v;
	return ret;
};

const usuarioSchema = new mongoose.Schema({
	nombre: { type: String },
	apellidos: { type: String },
	paisResidencia: { type: String },
	localidadResidencia: { type: String },
	lugarNacimiento: { type: String },
	tipoDocumento: { type: String, enum: ['dni', 'nie', 'pasaporte', null], default: null },
	numeroDocumento: { type: String },
	fechaNacimiento: { type: Date },
	correoElectronico: { type: String, required: true, trim: true, lowercase: true, index: true, unique: true },
	numeroTelefono: { type: String },
	diagnostico: {
		dislexia: { type: Boolean, default: false },
		discalculia: { type: Boolean, default: false },
		disortografía: { type: Boolean, default: false },
		dispraxia: { type: Boolean, default: false },
		tdah: { type: Boolean, default: false },
	},
	esTutor: { type: Boolean, default: false },
	tutorNombre: { type: String, default: '' },
	tutorApellidos: { type: String, default: '' },
	tutorParentesco: { type: String, default: '' },
	password: { type: String, required: true },
	emailVerificado: { type: Boolean, default: false },
	fechaCreacion: { type: Date, required: true },
	estado: { type: String, default: 'borrador' },
	mensajeMedico: { type: String, default: '' },
	numeroPasaporte: { type: Number, default: -1 },
	aceptoRecibirInfo: { type: Boolean, default: false },
	aceptoSolicitud: { type: Boolean, default: false },
	fechaConsentimiento: { type: Date, default: null },
	fechaEnvio: { type: Date, default: null },
	archivoBlob: { type: String, default: '' },
});
usuarioSchema.set('toJSON', { transform: stripSensitive });

const counterSchema = new mongoose.Schema({
	_id: { type: String, required: true },
	seq: { type: Number, default: 1000 },
});

const auditLogSchema = new mongoose.Schema({
	action: { type: String, required: true },
	actorType: { type: String, default: 'anonymous' },
	actorId: { type: String, default: null },
	target: { type: String, default: null },
	ip: { type: String, default: null },
	outcome: { type: String, default: null },
	meta: { type: Object, default: {} },
	at: { type: Date, default: Date.now },
});

const verifierSchema = new mongoose.Schema({
	nombre: { type: String, required: true },
	keyHash: { type: String, required: true, index: true },
	activo: { type: Boolean, default: true },
	fechaCreacion: { type: Date, default: Date.now },
	ultimoUso: { type: Date, default: null },
});

const COLLECTIONS = ['counters', 'verifiers', 'usuarios', 'auditlogs']; // foreign-key order
const TABLE_MODEL = { counters: 'counter', verifiers: 'verifier', usuarios: 'usuario', auditlogs: 'auditLog' };

// ---------------------------------------------------------------------------------------
// Bookkeeping: hard problems stop the copy, notes are reported. Only field names and counts.

const problems = new Map();
const notes = new Map();
const tally = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);

class Abort extends Error {}

const hasNul = value => {
	if (typeof value === 'string') return value.includes('\u0000');
	if (Array.isArray(value)) return value.some(hasNul);
	if (value && typeof value === 'object' && !(value instanceof Date)) return Object.values(value).some(hasNul);
	return false;
};

const isInt4 = n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;
const validDate = d => d instanceof Date && !Number.isNaN(d.getTime()) && d.getUTCFullYear() > -4712;

// Recursively sorted keys, so two JSON values compare equal regardless of key order.
const canon = value => {
	if (Array.isArray(value)) return value.map(canon);
	if (value && typeof value === 'object') {
		return Object.keys(value)
			.sort()
			.reduce((out, key) => ((out[key] = canon(value[key])), out), {});
	}
	return value;
};
const sameJson = (a, b) => JSON.stringify(canon(JSON.parse(JSON.stringify(a)))) === JSON.stringify(canon(JSON.parse(JSON.stringify(b))));

const checkType = (collection, field, value, type) => {
	if (value == null) return;
	const ok =
		type === 'string' ? typeof value === 'string'
		: type === 'boolean' ? typeof value === 'boolean'
		: type === 'date' ? validDate(value)
		: type === 'int' ? isInt4(value)
		: true;
	if (!ok) tally(problems, `${collection}.${field}: value not storable as ${type}`);
};

// ---------------------------------------------------------------------------------------
// Per-collection conversion: MongoDB document -> Postgres row (+ checks).

const usuarioFieldType = field => {
	if (DATE_FIELDS.has(field)) return 'date';
	if (field === 'numeroPasaporte') return 'int';
	if (['esTutor', 'emailVerificado', 'aceptoRecibirInfo', 'aceptoSolicitud'].includes(field)) return 'boolean';
	return 'string';
};

const convertUsuario = (Usuario, raw) => {
	const doc = Usuario.hydrate(raw);
	const json = doc.toJSON(); // what res.json(user) sent
	const password = doc.password;

	if (!(raw._id instanceof mongoose.Types.ObjectId)) tally(problems, 'usuarios._id: not an ObjectId');
	if (typeof json.correoElectronico !== 'string' || !json.correoElectronico) tally(problems, 'usuarios.correoElectronico: missing');
	if (typeof password !== 'string' || !password) tally(problems, 'usuarios.password: missing');

	for (const [field, kind] of FIELDS) {
		if (kind === 'nested') {
			const d = json.diagnostico;
			if (!d || typeof d !== 'object') tally(problems, 'usuarios.diagnostico: not an object');
			else {
				const allowed = new Set(DIAGNOSTICO.map(([k]) => k));
				for (const key of Object.keys(d)) {
					if (!allowed.has(key)) tally(problems, `usuarios.diagnostico.${key}: unknown key`);
					else checkType('usuarios', `diagnostico.${key}`, d[key], 'boolean');
				}
				const rawD = raw.diagnostico && typeof raw.diagnostico === 'object' ? raw.diagnostico : {};
				for (const [key] of DIAGNOSTICO) {
					if (!(key in rawD)) tally(notes, `usuarios.diagnostico.${key}: missing in MongoDB, filled with the default (as the API did)`);
				}
			}
			continue;
		}
		checkType('usuarios', field, json[field], usuarioFieldType(field));
		if (kind === 'optional' && json[field] === null) tally(notes, `usuarios.${field}: explicit null (kept in extra)`);
		if (kind === 'default' && !(field in raw)) {
			tally(
				notes,
				field === 'estado'
					? "usuarios.estado: missing in MongoDB, stored as 'borrador' (the API showed 'borrador', but MongoDB's admin lists and Excel export, which skip drafts, still included these records; now they are skipped)"
					: `usuarios.${field}: missing in MongoDB, filled with the default (as the API did)`
			);
		}
		if (field in raw && raw[field] != null && !sameJson({ v: raw[field] }, { v: json[field] })) {
			tally(notes, `usuarios.${field}: value cast by Mongoose (stored as returned by the API)`);
		}
		if (field in raw && raw[field] != null && json[field] === undefined) tally(problems, `usuarios.${field}: value Mongoose could not read`);
	}
	for (const key of Object.keys(json)) {
		if (!KNOWN_KEYS.has(key)) tally(notes, `usuarios.${key}: field from an older schema (kept in extra)`);
	}
	if (json.fechaCreacion == null) tally(notes, 'usuarios.fechaCreacion: missing (as today, these users cannot confirm email or change password)');
	if (typeof json.correoElectronico === 'string' && json.correoElectronico !== json.correoElectronico.trim().toLowerCase()) {
		tally(notes, 'usuarios.correoElectronico: not lowercase (as today, these users cannot log in by email)');
	}
	if (typeof password === 'string') {
		const m = /^\$2[aby]\$(\d\d)\$[./A-Za-z0-9]{53}$/.exec(password);
		tally(notes, m ? `usuarios.password: bcrypt cost ${m[1]}` : 'usuarios.password: NOT a bcrypt hash (login already fails for these)');
	}
	if (hasNul(json) || hasNul(password)) tally(problems, 'usuarios: text contains a NUL character (Postgres cannot store it)');

	const row = jsonToRow(json, password);
	if (!HEX24.test(row.id)) tally(problems, 'usuarios._id: not a 24-hex ObjectId');
	return { row, expected: JSON.parse(JSON.stringify(json)) };
};

const plain = doc => doc.toObject({ minimize: false, transform: false, virtuals: false, versionKey: false });

const extraKeys = (collection, obj, known) => {
	for (const key of Object.keys(obj)) {
		if (!known.includes(key)) tally(problems, `${collection}.${key}: field not in the schema (would be lost)`);
	}
};

const convertCounter = (Counter, raw) => {
	const o = plain(Counter.hydrate(raw));
	extraKeys('counters', o, ['_id', 'seq']);
	if (typeof o._id !== 'string') tally(problems, 'counters._id: not a string');
	checkType('counters', 'seq', o.seq, 'int');
	return { id: String(o._id), seq: o.seq };
};

const convertVerifier = (Verifier, raw) => {
	const o = plain(Verifier.hydrate(raw));
	const fields = ['nombre', 'keyHash', 'activo', 'fechaCreacion', 'ultimoUso'];
	extraKeys('verifiers', o, ['_id', ...fields]);
	if (!(raw._id instanceof mongoose.Types.ObjectId)) tally(problems, 'verifiers._id: not an ObjectId');
	if (typeof o.nombre !== 'string' || typeof o.keyHash !== 'string') tally(problems, 'verifiers: nombre/keyHash missing');
	checkType('verifiers', 'activo', o.activo, 'boolean');
	checkType('verifiers', 'fechaCreacion', o.fechaCreacion, 'date');
	checkType('verifiers', 'ultimoUso', o.ultimoUso, 'date');
	if (hasNul(o)) tally(problems, 'verifiers: text contains a NUL character');
	const row = { id: String(o._id) };
	for (const f of fields) row[f] = o[f] === undefined ? null : o[f];
	return row;
};

const convertAuditLog = (AuditLog, raw) => {
	const o = plain(AuditLog.hydrate(raw));
	const fields = ['action', 'actorType', 'actorId', 'target', 'ip', 'outcome', 'meta', 'at'];
	extraKeys('auditlogs', o, ['_id', ...fields]);
	if (!(raw._id instanceof mongoose.Types.ObjectId)) tally(problems, 'auditlogs._id: not an ObjectId');
	if (typeof o.action !== 'string') tally(problems, 'auditlogs.action: missing');
	for (const f of ['actorType', 'actorId', 'target', 'ip', 'outcome']) checkType('auditlogs', f, o[f], 'string');
	checkType('auditlogs', 'at', o.at, 'date');
	if (!('at' in raw)) tally(notes, 'auditlogs.at: missing in MongoDB, set to the copy time (Mongoose default)');
	if (hasNul(o)) tally(problems, 'auditlogs: text contains a NUL character');
	const row = { id: String(o._id) };
	for (const f of fields) row[f] = o[f] === undefined ? null : o[f];
	row.meta = row.meta == null ? Prisma.DbNull : JSON.parse(JSON.stringify(row.meta));
	return row;
};

// Prisma wants JSON nulls spelled out; a missing `extra` stays SQL NULL.
const forCreate = row => {
	const out = { ...row };
	if (out.extra == null) delete out.extra;
	return out;
};

// ---------------------------------------------------------------------------------------

const scrubUrl = s => String(s).replace(/\/\/[^@/\s]*@/g, '//***@');

const main = async () => {
	const args = process.argv.slice(2);
	const known = new Set(['--replace', '--allow-atlas']);
	if (args.some(a => !known.has(a))) {
		console.error(USAGE);
		process.exit(2);
	}
	const replace = args.includes('--replace');
	const { MONGO_URL, DATABASE_URL } = process.env;
	if (!MONGO_URL || !DATABASE_URL) {
		console.error(USAGE);
		process.exit(2);
	}
	if (/^mongodb\+srv:/i.test(MONGO_URL) || /\.mongodb\.net([:/?,]|$)/i.test(MONGO_URL)) {
		if (!args.includes('--allow-atlas')) {
			console.error('MONGO_URL points at MongoDB Atlas. Copy from a restored copy instead (or pass --allow-atlas).');
			process.exit(2);
		}
	}

	// --- read MongoDB (read-only: no index builds, no collection creation) ---
	let conn;
	try {
		conn = await mongoose.createConnection(MONGO_URL, { autoIndex: false, autoCreate: false }).asPromise();
	} catch (err) {
		console.error(`Cannot connect to MONGO_URL: ${err.name}: ${scrubUrl(err.message)}`);
		process.exit(1);
	}
	const models = {
		usuarios: conn.model('usuario', usuarioSchema),
		counters: conn.model('counter', counterSchema),
		auditlogs: conn.model('auditLog', auditLogSchema),
		verifiers: conn.model('verifier', verifierSchema),
	};

	const present = (await conn.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
	for (const name of present.sort()) {
		if (!COLLECTIONS.includes(name) && !name.startsWith('system.')) {
			const n = await conn.db.collection(name).estimatedDocumentCount();
			tally(notes, `collection "${name}" (${n} documents) is not used by the app and is NOT copied`);
		}
	}

	const source = {};
	const rows = {};
	const expected = new Map();
	for (const name of COLLECTIONS) {
		const raws = present.includes(name) ? await conn.db.collection(name).find({}).toArray() : [];
		source[name] = raws.length;
		if (name === 'usuarios') {
			rows[name] = raws.map(raw => {
				const { row, expected: json } = convertUsuario(models.usuarios, raw);
				expected.set(row.id, { json, password: row.password });
				return row;
			});
		} else if (name === 'counters') rows[name] = raws.map(raw => convertCounter(models.counters, raw));
		else if (name === 'verifiers') rows[name] = raws.map(raw => convertVerifier(models.verifiers, raw));
		else rows[name] = raws.map(raw => convertAuditLog(models.auditlogs, raw));
	}
	await conn.close();

	// Duplicates Postgres will refuse (MongoDB may hold them if its unique index never built).
	const dupes = (list, key) => {
		const seen = new Map();
		for (const r of list) {
			const k = key(r);
			if (k != null) seen.set(k, (seen.get(k) || 0) + 1);
		}
		return [...seen.values()].filter(n => n > 1).length;
	};
	const emailDupes = dupes(rows.usuarios, r => r.correoElectronico);
	if (emailDupes) tally(problems, 'usuarios.correoElectronico: duplicate values (groups)', emailDupes);
	const passportDupes = dupes(rows.usuarios, r => (r.numeroPasaporte >= 1000 ? r.numeroPasaporte : null));
	if (passportDupes) tally(problems, 'usuarios.numeroPasaporte: duplicate issued numbers (groups)', passportDupes);

	if (problems.size) {
		console.error('Not copied. The source data has values Postgres cannot take as they are:');
		for (const [k, n] of problems) console.error(`  - ${k}: ${n}`);
		console.error('Fix them in the restored MongoDB copy (not in production) and run again.');
		process.exit(1);
	}

	// --- write Postgres ---
	// bcrypt works in this runtime (same library and version as the app) before anything is written.
	const probe = `probe-${Date.now()}`;
	if (!(await bcrypt.compare(probe, await bcrypt.hash(probe, 10)))) throw new Abort('bcrypt self-test failed');

	const prisma = getPrisma();
	const before = {};
	for (const name of COLLECTIONS) before[name] = await prisma[TABLE_MODEL[name]].count();
	const nonEmpty = COLLECTIONS.filter(name => before[name] > 0);
	if (nonEmpty.length && !replace) {
		console.error(`Not copied: target tables are not empty (${nonEmpty.map(n => `${n}: ${before[n]}`).join(', ')}). Pass --replace to empty them first.`);
		process.exit(1);
	}

	const target = {};
	let jsonOk = 0;
	let hashOk = 0;
	await prisma.$transaction(
		async tx => {
			if (replace) await tx.$executeRawUnsafe('TRUNCATE TABLE usuarios, counters, auditlogs, verifiers RESTART IDENTITY');
			for (const name of COLLECTIONS) {
				const model = tx[TABLE_MODEL[name]];
				for (let i = 0; i < rows[name].length; i += BATCH) {
					await model.createMany({ data: rows[name].slice(i, i + BATCH).map(forCreate) });
				}
				target[name] = await model.count();
			}
			const mismatched = COLLECTIONS.filter(name => target[name] !== source[name]);
			if (mismatched.length) throw new Abort(`count mismatch in ${mismatched.join(', ')}`);

			// Every user must serialize exactly as the old API did, with the same password hash.
			const stored = await tx.usuario.findMany();
			for (const row of stored) {
				const want = expected.get(row.id);
				if (want && sameJson(rowToJson(row), want.json)) jsonOk += 1;
				if (want && row.password === want.password) hashOk += 1;
			}
			if (jsonOk !== source.usuarios || hashOk !== source.usuarios) {
				throw new Abort(`usuarios differ from the old API output (JSON identical: ${jsonOk}/${source.usuarios}, hashes identical: ${hashOk}/${source.usuarios})`);
			}

			// Optional end-to-end check with a known account: CHECK_LOGIN_EMAIL + CHECK_LOGIN_PASSWORD.
			const { CHECK_LOGIN_EMAIL, CHECK_LOGIN_PASSWORD } = process.env;
			if (CHECK_LOGIN_EMAIL && CHECK_LOGIN_PASSWORD) {
				const u = await tx.usuario.findUnique({ where: { correoElectronico: CHECK_LOGIN_EMAIL.trim().toLowerCase() } });
				const ok = Boolean(u) && (await bcrypt.compare(CHECK_LOGIN_PASSWORD, u.password));
				if (!ok) throw new Abort('CHECK_LOGIN_EMAIL / CHECK_LOGIN_PASSWORD did not validate against the copied hash');
				tally(notes, 'login check with CHECK_LOGIN_EMAIL: password validates against the copied hash');
			}
		},
		{ timeout: 30 * 60 * 1000, maxWait: 60 * 1000 }
	);
	await prisma.$disconnect();

	console.log('MongoDB -> Postgres copy committed.');
	console.log('table        source   target');
	for (const name of COLLECTIONS) console.log(`${name.padEnd(12)} ${String(source[name]).padStart(6)}   ${String(target[name]).padStart(6)}`);
	console.log(`usuarios serialized identically to the old API: ${jsonOk}/${source.usuarios}`);
	console.log(`password hashes copied byte for byte: ${hashOk}/${source.usuarios}`);
	if (notes.size) {
		console.log('Notes:');
		for (const [k, n] of [...notes].sort()) console.log(k.startsWith('collection ') ? `  - ${k}` : `  - ${k}: ${n}`);
	}
};

main().catch(err => {
	if (err instanceof Abort) console.error(`Rolled back, nothing copied: ${err.message}`);
	else {
		// Never print database error messages: they can quote record contents. Constraint
		// names are safe to show.
		const constraint = /constraint "([^"]+)"/.exec(String(err.message || ''));
		const detail = [err.name, err.code, err.meta && (err.meta.target || err.meta.constraint), constraint && constraint[1]]
			.filter(Boolean)
			.join(' ');
		console.error(`Rolled back, nothing copied: ${detail || 'unexpected error'}`);
	}
	process.exit(1);
});
