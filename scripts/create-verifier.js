// Issues a per-verifier API key (SECURITY_ASSESSMENT.md §9). The key is shown ONCE;
// only its hash is stored. Usage: node scripts/create-verifier.js "Aeropuerto Barajas"
// (DATABASE_URL must point at the Postgres database.)
require('dotenv/config');
const crypto = require('crypto');
const { getPrisma } = require('../db/prisma');
const { newObjectId } = require('../db/objectId');
const { hashKey } = require('../functions/verifier');

(async () => {
	const nombre = process.argv[2];
	if (!nombre) {
		console.error('Uso: node scripts/create-verifier.js "<nombre del verificador>"');
		process.exit(1);
	}
	const prisma = getPrisma();

	const key = crypto.randomBytes(24).toString('base64url');
	await prisma.verifier.create({ data: { id: newObjectId(), nombre, keyHash: hashKey(key) } });

	console.log(`Verificador "${nombre}" creado.`);
	console.log(`API key (guárdela ahora, no se mostrará de nuevo): ${key}`);
	await prisma.$disconnect();
})().catch(err => {
	console.error(err);
	process.exit(1);
});
