const crypto = require('crypto');
const { getPrisma, wrap, DbError, isUniqueViolation } = require('../db/prisma');
const { newObjectId } = require('../db/objectId');
const { deleteBlob, uploadBlob } = require('./blob');
const logger = require('./logger');

// "Hazles una foto con el móvil" (GON-78): the computer shows a QR and a 6-digit code; the
// phone opens a public page with the link token (or the code) and sends photos, which are
// stored as separate blobs ("staged") until the documents are joined into the record's PDF.

const TOKEN_MINUTES = 15;
const STAGED_DAYS = 30;
const GRUPOS = ['diagnostico', 'documento'];
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^\d{6}$/;
const MINUTE = 60 * 1000;

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const tokens = () => getPrisma().phoneToken;
const staged = () => getPrisma().stagedFile;

// A new link for the record. The record's earlier links stop working, and expired links of
// anyone are removed so their codes can be given out again. Returns { token, codigo, caduca }.
const createPhoneToken = async (usuarioId, now = new Date()) => {
	await wrap('phone_tokens.deleteMany', tokens().deleteMany({ where: { OR: [{ usuarioId }, { caduca: { lte: now } }] } }));
	const caduca = new Date(now.getTime() + TOKEN_MINUTES * MINUTE);
	for (let attempt = 0; ; attempt++) {
		const token = newToken();
		const codigo = newCode();
		try {
			await tokens().create({ data: { id: hashToken(token), usuarioId, codigo, caduca } });
			return { token, codigo, caduca };
		} catch (err) {
			// Another live link holds this code: draw another one.
			if (!isUniqueViolation(err) || attempt >= 4) throw new DbError('phone_tokens.create', err);
		}
	}
};

// The live link row for a token, or null when it is malformed, unknown, replaced or expired.
const findPhoneToken = async (token, now = new Date()) => {
	if (typeof token !== 'string' || !TOKEN.test(token)) return null;
	const row = await wrap('phone_tokens.findUnique', tokens().findUnique({ where: { id: hashToken(token) } }));
	if (!row || row.caduca <= now) return null;
	return row;
};

// Exchanges a typed code for a link token of its own (only hashes are stored, so the QR's
// token cannot be handed back). The code works once. Returns the token, or null.
const exchangeCode = async (codigo, now = new Date()) => {
	if (typeof codigo !== 'string' || !CODE.test(codigo)) return null;
	const row = await wrap('phone_tokens.findUnique', tokens().findUnique({ where: { codigo } }));
	if (!row || row.caduca <= now) return null;
	const used = await wrap('phone_tokens.updateMany', tokens().updateMany({ where: { id: row.id, codigo }, data: { codigo: null } }));
	if (used.count !== 1) return null;
	const token = newToken();
	await wrap(
		'phone_tokens.create',
		tokens().create({ data: { id: hashToken(token), usuarioId: row.usuarioId, caduca: row.caduca, conectadoEn: now } })
	);
	return token;
};

const markConnected = (row, now = new Date()) =>
	row.conectadoEn ? Promise.resolve() : wrap('phone_tokens.update', tokens().update({ where: { id: row.id }, data: { conectadoEn: now } }));

// Whether a phone has opened one of the record's live links.
const phoneConnected = async (usuarioId, now = new Date()) =>
	Boolean(
		await wrap(
			'phone_tokens.findFirst',
			tokens().findFirst({ where: { usuarioId, caduca: { gt: now }, conectadoEn: { not: null } }, select: { id: true } })
		)
	);

// The record's staged files, diagnosis first, each group in the order they arrived.
const listStaged = async usuarioId => {
	const rows = await wrap(
		'staged_files.findMany',
		staged().findMany({ where: { usuarioId }, orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }] })
	);
	return GRUPOS.flatMap(grupo => rows.filter(row => row.grupo === grupo));
};

const countStaged = usuarioId => wrap('staged_files.count', staged().count({ where: { usuarioId } }));

// Staged blobs live in the record's folder, so deleting the record's documents deletes them too.
const stagedBlobName = (usuarioId, id, tipo) => `${usuarioId}/movil/${id}.${tipo.split('/')[1]}`;

const addStaged = async (usuarioId, grupo, file) => {
	const last = await wrap(
		'staged_files.findFirst',
		staged().findFirst({ where: { usuarioId, grupo }, orderBy: { orden: 'desc' }, select: { orden: true } })
	);
	const id = newObjectId();
	const blob = stagedBlobName(usuarioId, id, file.mimetype);
	await uploadBlob(blob, file.data, file.mimetype);
	return wrap(
		'staged_files.create',
		staged().create({ data: { id, usuarioId, grupo, orden: last ? last.orden + 1 : 1, blob, tipo: file.mimetype, tamano: file.data.length } })
	);
};

// Deletes the rows, then the blobs: a joined photo must not be listed or joined again even
// when its blob cannot be deleted. Such a blob stays in the record's folder, which goes with
// the record; the caller logs the failure.
const removeStaged = async rows => {
	const result = { deleted: 0, failed: 0, error: null };
	if (!rows.length) return result;
	await wrap('staged_files.deleteMany', staged().deleteMany({ where: { id: { in: rows.map(row => row.id) } } }));
	for (const row of rows) {
		try {
			await deleteBlob(row.blob);
			result.deleted++;
		} catch (err) {
			result.failed++;
			result.error = err;
		}
	}
	return result;
};

const findOwnStaged = (usuarioId, id) =>
	wrap('staged_files.findFirst', staged().findFirst({ where: { id: String(id), usuarioId } }));

// Staged photos older than STAGED_DAYS (an application left unsent) and expired links. Each
// blob goes before its row, so a blob that cannot be deleted is tried again on the next sweep.
// Logs counts only.
const purgeStale = async (now = new Date()) => {
	const before = new Date(now.getTime() - STAGED_DAYS * 24 * 60 * MINUTE);
	const rows = await wrap('staged_files.findMany', staged().findMany({ where: { creadoEn: { lt: before } } }));
	const summary = { deleted: 0, failed: 0, expiredLinks: 0 };
	let error = null;
	const gone = [];
	for (const row of rows) {
		try {
			await deleteBlob(row.blob);
			gone.push(row.id);
			summary.deleted++;
		} catch (err) {
			summary.failed++;
			error = err;
		}
	}
	if (gone.length) await wrap('staged_files.deleteMany', staged().deleteMany({ where: { id: { in: gone } } }));
	summary.expiredLinks = (await wrap('phone_tokens.deleteMany', tokens().deleteMany({ where: { caduca: { lte: now } } }))).count;
	if (error) logger.warn({ ...summary, code: error.code || error.name || 'unknown' }, 'stale phone photos not fully deleted');
	else if (rows.length || summary.expiredLinks) logger.info(summary, 'stale phone photos deleted');
	return summary;
};

// Runs purgeStale now and then every `hours`. Never rejects: a failed sweep is logged and the
// next one tries again.
const scheduleStalePurge = (hours = 6) => {
	const run = () => purgeStale().catch(err => logger.error({ code: err.code || err.name }, 'stale phone photo sweep failed'));
	setTimeout(run, MINUTE).unref();
	setInterval(run, hours * 60 * MINUTE).unref();
};

module.exports = {
	createPhoneToken,
	findPhoneToken,
	exchangeCode,
	markConnected,
	phoneConnected,
	listStaged,
	countStaged,
	addStaged,
	removeStaged,
	findOwnStaged,
	purgeStale,
	scheduleStalePurge,
};
