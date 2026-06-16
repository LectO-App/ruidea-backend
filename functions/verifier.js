const crypto = require('crypto');
const Verifier = require('../models/verifier');

const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');

// Resolves a relying-party credential from the X-Verifier-Key header. Returns the
// verifier doc when the key matches an active record, else null.
const resolveVerifier = async req => {
	const key = req.get('x-verifier-key');
	if (!key) return null;
	const verifier = await Verifier.findOne({ keyHash: hashKey(key), activo: true });
	if (verifier) {
		verifier.ultimoUso = new Date();
		verifier.save().catch(() => {});
	}
	return verifier;
};

module.exports = { hashKey, resolveVerifier };
