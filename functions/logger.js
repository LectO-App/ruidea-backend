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
			'res.headers["set-cookie"]',
			'password',
			'*.password',
			'DB_CONNECTION',
			'DATABASE_URL',
			'MONGO_URL',
			'AZURE_STORAGE_CONNECTION_STRING',
		],
		remove: true,
	},
});

// Two routes carry personal data or a credential in the URL: the passport share link
// (/usuario/verificar/:numeroDocumento/:numeroPasaporte) and the email-verification links
// (/emailVerification/confirm|resend/:token). pino-http logs every request URL and its route
// params, so log the route pattern there instead, and never the params.
const MASKED_URLS = [
	[/\/usuario\/verificar\/[^?#]*/i, '/usuario/verificar/:numeroDocumento/:numeroPasaporte'],
	[/\/emailVerification\/(confirm|resend)\/[^?#]+/i, '/emailVerification/$1/:token'],
];

const requestSerializer = req => {
	if (typeof req.url === 'string') {
		for (const [pattern, replacement] of MASKED_URLS) req.url = req.url.replace(pattern, replacement);
	}
	delete req.params;
	return req;
};

module.exports = logger;
module.exports.requestSerializer = requestSerializer;
