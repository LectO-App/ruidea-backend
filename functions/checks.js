const { getPrisma, wrap } = require('../db/prisma');

// A holder's own check history (GET /usuario/me/comprobaciones): the successful
// verifications of their passport, from the audit log. Only what the holder may see leaves
// this module: when, how (QR or link, or an organisation's lookup), country, device class and
// the verifier's name. Never the IP, the audit row id, the verifier id or a token.

const DIAS = 90;
const MAX_LIST = 50;
// Rows read per request; more than MAX_LIST so the follow-up opens below can be dropped and
// the total still counts every check in the window for any realistic passport.
const MAX_READ = 1000;
const SHARED_VERIFIER = 'una entidad verificadora';
const ACTIONS = ['passport.verify_token', 'passport.verify_link', 'passport.lookup'];
const FOLLOW_UP_MS = 2 * 60 * 1000;

// A successful verifier lookup opens the passport's public page, which writes its own
// verify_token or verify_link audit. That open is part of the same check (functions/stats.js
// skips it the same way).
const dropFollowUps = rows => {
	const lookups = rows.filter(r => r.action === 'passport.lookup').map(r => r.at.getTime());
	return rows.filter(r => {
		if (r.action === 'passport.lookup') return true;
		const t = r.at.getTime();
		return !lookups.some(l => l <= t && t - l < FOLLOW_UP_MS);
	});
};

const verifierNames = async rows => {
	const ids = [...new Set(rows.filter(r => r.action === 'passport.lookup' && r.actorId && r.actorId !== 'shared').map(r => r.actorId))];
	if (ids.length === 0) return new Map();
	const found = await wrap('verifiers.names', getPrisma().verifier.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true } }));
	return new Map(found.map(v => [v.id, v.nombre]));
};

const listChecks = async (numeroPasaporte, now = new Date()) => {
	const rows = await wrap(
		'auditlogs.checks',
		getPrisma().auditLog.findMany({
			where: {
				action: { in: ACTIONS },
				outcome: 'success',
				target: String(numeroPasaporte),
				at: { gte: new Date(now.getTime() - DIAS * 24 * 60 * 60 * 1000) },
			},
			orderBy: { at: 'desc' },
			take: MAX_READ,
			select: { action: true, actorId: true, meta: true, at: true },
		})
	);
	const checks = dropFollowUps(rows);
	const shown = checks.slice(0, MAX_LIST);
	const names = await verifierNames(shown);
	return {
		dias: DIAS,
		total: checks.length,
		comprobaciones: shown.map(r => {
			const meta = r.meta || {};
			const entry = { fecha: r.at.toISOString(), tipo: r.action === 'passport.lookup' ? 'entidad' : 'qr_o_enlace', pais: meta.country || null, dispositivo: meta.device || null };
			if (entry.tipo === 'entidad') entry.entidad = names.get(r.actorId) || SHARED_VERIFIER;
			return entry;
		}),
	};
};

const emptyChecks = () => ({ dias: DIAS, total: 0, comprobaciones: [] });

module.exports = { listChecks, emptyChecks };
