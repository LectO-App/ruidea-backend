const pino = require('pino');

// Structured logging replacing scattered console.log (SECURITY_ASSESSMENT.md §8.1, §9).
// Redacts known-sensitive fields so secrets/PII never land in logs.
const logger = pino({
	level: process.env.LOG_LEVEL || 'info',
	redact: {
		paths: [
			'req.headers.authkey',
			'req.headers.cookie',
			'req.headers["x-csrf-token"]',
			'req.headers["x-verifier-key"]',
			'req.headers.authorization',
			'password',
			'*.password',
			'DB_CONNECTION',
			'AZURE_STORAGE_CONNECTION_STRING',
		],
		remove: true,
	},
});

module.exports = logger;
