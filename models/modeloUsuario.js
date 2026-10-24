// Users (`usuarios` table). Replaces the Mongoose model with explicit queries that keep
// the old behaviour: same ids, same JSON (db/usuarioJson.js), same matching and ordering.
//
// Records come back as plain objects shaped like the old Mongoose documents: the API
// fields, `_id`, a non-enumerable `id`, the `password` hash (code only), and a toJSON()
// that leaves the hash out, so res.json(user) returns exactly what it did before.
const { getPrisma, wrap, DbError, isNotFound } = require('../db/prisma');
const { castObjectId, newObjectId } = require('../db/objectId');
const { rowToJson, toData } = require('../db/usuarioJson');

const db = () => getPrisma().usuario;

const toUsuario = row => {
	if (!row) return null;
	const doc = { ...rowToJson(row), password: row.password };
	Object.defineProperties(doc, {
		id: {
			get() {
				return this._id;
			},
		},
		toJSON: {
			value() {
				const out = { ...this };
				delete out.password;
				return out;
			},
		},
	});
	return doc;
};

// MongoDB returned unsorted matches, and sort ties, in insertion order (`orden`).
const NATURAL = [{ orden: 'asc' }];
// sort({ fechaCreacion: -1 }): MongoDB puts missing dates last.
const NEWEST_FIRST = [{ fechaCreacion: { sort: 'desc', nulls: 'last' } }, { orden: 'asc' }];

// Filters the routes use: {} (all), { estado } (equal), { estadoNot } (MongoDB's $ne, which
// also matched records without an estado).
const whereOf = (filter = {}) => {
	if (filter.estado !== undefined) return { estado: filter.estado };
	if (filter.estadoNot !== undefined) return { OR: [{ estado: { not: filter.estadoNot } }, { estado: null }] };
	return {};
};

const isInt4 = n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

// Throws CastError for an id that isn't an ObjectId string, as Mongoose did.
const findById = async id => {
	const key = castObjectId(id);
	if (key == null) return null;
	return toUsuario(await wrap('usuarios.findById', db().findUnique({ where: { id: key } })));
};

// Emails are matched trimmed and lowercased (Mongoose applied the schema setters to queries).
const findByEmail = async email => {
	if (typeof email !== 'string') return null;
	const correoElectronico = email.trim().toLowerCase();
	return toUsuario(await wrap('usuarios.findByEmail', db().findUnique({ where: { correoElectronico } })));
};

// First record with this passport number (and estado, if given). A number that isn't a
// 32-bit integer matches nothing, as in MongoDB (Postgres would reject it instead).
const findByPassportNumber = async (numeroPasaporte, estado) => {
	if (!isInt4(numeroPasaporte)) return null;
	const where = { numeroPasaporte };
	if (estado !== undefined) where.estado = estado;
	return toUsuario(await wrap('usuarios.findByPassportNumber', db().findFirst({ where, orderBy: NATURAL })));
};

// { sort: 'newest' } = sort({ fechaCreacion: -1 }); default is insertion order.
const find = async (filter, { sort, skip, limit } = {}) => {
	const rows = await wrap(
		'usuarios.find',
		db().findMany({
			where: whereOf(filter),
			orderBy: sort === 'newest' ? NEWEST_FIRST : NATURAL,
			skip: skip || undefined,
			take: limit || undefined,
		})
	);
	return rows.map(toUsuario);
};

const count = filter => wrap('usuarios.count', db().count({ where: whereOf(filter) }));

// Whether an issued passport number (>= 1000) belongs to a record other than `exceptId`.
const passportNumberTaken = async (numeroPasaporte, exceptId) => {
	if (!isInt4(numeroPasaporte) || numeroPasaporte < 1000) return false;
	const where = { numeroPasaporte };
	if (exceptId != null) where.id = { not: String(exceptId) };
	return Boolean(await wrap('usuarios.passportNumberTaken', db().findFirst({ where, select: { id: true } })));
};

const emailExists = async email => {
	if (typeof email !== 'string') return false;
	const correoElectronico = email.trim().toLowerCase();
	const row = await wrap('usuarios.emailExists', db().findUnique({ where: { correoElectronico }, select: { id: true } }));
	return Boolean(row);
};

const create = async values =>
	toUsuario(await wrap('usuarios.create', db().create({ data: { ...toData(values), id: newObjectId() } })));

// findByIdAndUpdate(id, { $set: values }, { new: true }): the updated record, or null.
const updateById = async (id, values) => {
	const key = castObjectId(id);
	if (key == null) return null;
	try {
		return toUsuario(await db().update({ where: { id: key }, data: toData(values) }));
	} catch (err) {
		if (isNotFound(err)) return null;
		throw new DbError('usuarios.update', err);
	}
};

// findByIdAndDelete(id): the deleted record, or null.
const deleteById = async id => {
	const key = castObjectId(id);
	if (key == null) return null;
	try {
		return toUsuario(await db().delete({ where: { id: key } }));
	} catch (err) {
		if (isNotFound(err)) return null;
		throw new DbError('usuarios.delete', err);
	}
};

// doc.save() after changing some fields. Mongoose validated the whole document first, so
// a record missing a required field (records older than fechaCreacion lack it) could not
// be saved; keep that outcome.
const save = async (doc, values) => {
	for (const field of ['correoElectronico', 'password', 'fechaCreacion']) {
		if (doc[field] == null || doc[field] === '') {
			const err = new Error(`Validation failed: ${field} is required`);
			err.name = 'ValidationError';
			throw err;
		}
	}
	return updateById(doc._id, values);
};

module.exports = {
	findById,
	findByEmail,
	findByPassportNumber,
	find,
	count,
	emailExists,
	passportNumberTaken,
	create,
	updateById,
	deleteById,
	save,
	toUsuario,
};
