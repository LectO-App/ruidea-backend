// Prisma client for the Postgres database at DATABASE_URL. Created lazily, so modules that
// only import helpers (and the unit tests) don't need a generated client or a database.

let client = null;

const getPrisma = () => {
	if (!client) {
		const { PrismaClient } = require('@prisma/client');
		client = new PrismaClient({ errorFormat: 'minimal' });
	}
	return client;
};

// Prisma error messages can quote the data of the failing query (names, document numbers).
// Rethrow database errors as a generic error that carries only the operation, the Prisma
// error code and the constraint, so a logged `err` never contains personal data.
class DbError extends Error {
	constructor(op, err) {
		const code = (err && (err.code || err.errorCode)) || (err && err.name) || 'unknown';
		super(`${op} failed (${code})`);
		this.name = 'DbError';
		this.code = code;
		if (err && err.meta && err.meta.target) this.target = err.meta.target;
	}
}

const wrap = (op, promise) =>
	promise.catch(err => {
		throw new DbError(op, err);
	});

// Unique-constraint violation (MongoDB's duplicate-key error 11000 before the migration).
const isUniqueViolation = err => Boolean(err) && err.code === 'P2002';

// Row not found for update/delete.
const isNotFound = err => Boolean(err) && err.code === 'P2025';

// Unique violation on the issued-passport-number index.
const isPassportNumberTaken = err => isUniqueViolation(err) && /numeroPasaporte/.test(JSON.stringify(err.target || ''));

module.exports = { getPrisma, wrap, DbError, isUniqueViolation, isNotFound, isPassportNumberTaken };
