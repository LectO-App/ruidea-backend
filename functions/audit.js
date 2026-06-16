const AuditLog = require('../models/auditLog');
const logger = require('./logger');

// Fire-and-forget audit writer: never let logging failure break the request, but do
// surface it to the structured logger.
const writeAudit = (req, entry) => {
	const ip = req && (req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress);
	AuditLog.create({ ip, ...entry }).catch(err => logger.error({ err }, 'audit write failed'));
};

module.exports = { writeAudit };
