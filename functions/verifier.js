const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
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

// Hourly quota per verifier key, counted across all addresses the key is used from (the
// per-IP verifyLimiter allows 240 an hour from one address; this default matches it, so one
// key can't do more than one address can). Only requests carrying a valid key count (the
// route sets req.verifier first). The shared password gets no global bucket: any holder
// could use it up and lock every relying party out. VERIFIER_KEY_HOURLY_LIMIT overrides.
const verifierKeyQuota = rateLimit({
	standardHeaders: true,
	legacyHeaders: false,
	windowMs: 60 * 60 * 1000,
	max: () => Number(process.env.VERIFIER_KEY_HOURLY_LIMIT) || 240,
	skip: req => !req.verifier,
	keyGenerator: req => `verifier:${String(req.verifier._id)}`,
	message: { correcto: false, message: 'Este verificador superó su límite de consultas por hora.' },
});

module.exports = { hashKey, resolveVerifier, verifierKeyQuota };
