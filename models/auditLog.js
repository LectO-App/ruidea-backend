const mongoose = require('mongoose');

// Append-only audit trail for sensitive actions (admin decisions, document access,
// exports, passport verification) — SECURITY_ASSESSMENT.md §8.1.
const AuditLog = mongoose.Schema({
	action: { type: String, required: true },
	actorType: { type: String, default: 'anonymous' }, // user | admin | verifier | anonymous
	actorId: { type: String, default: null },
	target: { type: String, default: null },
	ip: { type: String, default: null },
	outcome: { type: String, default: null }, // success | denied | not_found
	meta: { type: Object, default: {} },
	at: { type: Date, default: Date.now },
});

AuditLog.index({ at: -1 });
AuditLog.index({ action: 1, at: -1 });

module.exports = mongoose.model('auditLog', AuditLog);
