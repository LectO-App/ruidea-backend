// Issues a per-verifier API key (SECURITY_ASSESSMENT.md §9). The key is shown ONCE;
// only its hash is stored. Usage: node scripts/create-verifier.js "Aeropuerto Barajas"
require('dotenv/config');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Verifier = require('../models/verifier');
const { hashKey } = require('../functions/verifier');

(async () => {
	const nombre = process.argv[2];
	if (!nombre) {
		console.error('Uso: node scripts/create-verifier.js "<nombre del verificador>"');
		process.exit(1);
	}
	await mongoose.connect(process.env.DB_CONNECTION, { useNewUrlParser: true, useUnifiedTopology: true });

	const key = crypto.randomBytes(24).toString('base64url');
	await Verifier.create({ nombre, keyHash: hashKey(key) });

	console.log(`Verificador "${nombre}" creado.`);
	console.log(`API key (guárdela ahora, no se mostrará de nuevo): ${key}`);
	await mongoose.disconnect();
})().catch(err => {
	console.error(err);
	process.exit(1);
});
