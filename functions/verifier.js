const crypto = require('crypto');
const { getPrisma, wrap } = require('../db/prisma');

const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');

// Resolves a relying-party credential from the X-Verifier-Key header. Returns the
// verifier row when the key matches an active record, else null.
const resolveVerifier = async req => {
	const key = req.get('x-verifier-key');
	if (!key) return null;
	const prisma = getPrisma();
	const verifier = await wrap(
		'verifiers.find',
		prisma.verifier.findFirst({ where: { keyHash: hashKey(key), activo: true }, orderBy: { id: 'asc' } })
	);
	if (verifier) {
		prisma.verifier.update({ where: { id: verifier.id }, data: { ultimoUso: new Date() } }).catch(() => {});
	}
	return verifier;
};

module.exports = { hashKey, resolveVerifier };
