const mongoose = require('mongoose');

// A relying party (airport, school, agency) that may verify passports. Replaces the
// single global VERIFY_PASSWORD with scoped, individually-revocable credentials
// (SECURITY_ASSESSMENT.md §1.8, §9). Keys are stored only as SHA-256 hashes.
const Verifier = mongoose.Schema({
	nombre: { type: String, required: true },
	keyHash: { type: String, required: true, index: true },
	activo: { type: Boolean, default: true },
	fechaCreacion: { type: Date, default: Date.now },
	ultimoUso: { type: Date, default: null },
});

module.exports = mongoose.model('verifier', Verifier);
