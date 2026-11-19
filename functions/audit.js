const { getPrisma } = require('../db/prisma');
const { newObjectId } = require('../db/objectId');
const { visitorCountry } = require('../middlewares/client-ip');
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

const deviceClass = userAgent => {
	const ua = String(userAgent || '');
	if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
	if (/Windows NT|Macintosh|X11|CrOS|Linux/i.test(ua)) return 'desktop';
	return 'other';
};

// Passport verifications (QR / share link, legacy link, verifier lookup) feed the admin
// statistics: they store the visitor's country and a coarse device class, and no IP, because
// holders are often minors and a verification trail per IP would locate them.
const writeVerifyAudit = (req, entry) =>
	writeAudit(req, {
		...entry,
		ip: null,
		meta: { country: visitorCountry(req), device: deviceClass(req.get('user-agent')) },
	});

module.exports = { writeAudit, writeVerifyAudit, deviceClass };
