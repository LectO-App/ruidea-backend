const { getPrisma } = require('../db/prisma');
const { newObjectId } = require('../db/objectId');
const logger = require('./logger');

// Fire-and-forget audit writer: never let logging failure break the request, but do
// surface it to the structured logger (error code only, never the row's data).
const writeAudit = (req, entry) => {
	// req.ip follows app.js's `trust proxy` setting; the raw X-Forwarded-For header is whatever
	// the client sent, so it is not stored as the audit IP.
	const ip = req && (req.ip || req.connection?.remoteAddress);
	getPrisma()
		.auditLog.create({ data: { id: newObjectId(), ip: ip || null, ...entry } })
		.catch(err => logger.error({ code: err.code || err.name }, 'audit write failed'));
};

module.exports = { writeAudit };
