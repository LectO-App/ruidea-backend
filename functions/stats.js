const { getPrisma } = require('../db/prisma');

// Usage statistics for the admin panel (GET /admin/estadisticas). Every number is an
// aggregate computed in SQL; no query selects a name, document number, passport number, IP
// or email, and no answer lists a location per passport. Buckets with fewer than
// MIN_BUCKET rows are merged into 'Otros' so a rare country or diagnosis cannot point at a
// person (holders are often minors).

const MIN_BUCKET = 5;
const OTROS = 'Otros';

const VERIFY_ACTIONS = `('passport.verify_token', 'passport.verify_link', 'passport.lookup')`;
const KIND = { 'passport.verify_token': 'qr', 'passport.verify_link': 'enlace', 'passport.lookup': 'verificador' };
const FAILURES = ['not_found', 'document_mismatch', 'denied', 'legacy_disabled'];
const DIAGNOSES = ['dislexia', 'discalculia', 'disortografia', 'dispraxia', 'tdah'];

// $1 = desde (inclusive), $2 = hasta (exclusive); either may be null.
const inRange = col => `($1::timestamptz IS NULL OR ${col} >= $1::timestamptz) AND ($2::timestamptz IS NULL OR ${col} < $2::timestamptz)`;

// A successful verifier check opens the passport's public page (/verificar/<token>, or the
// legacy link when the passport has no token), which writes its own verify_token or
// verify_link audit. That open is part of the same check, not a scan or a failed check:
// skip it when a lookup success for the same passport came in the 2 minutes before it.
const FOLLOW_UP = `(action <> 'passport.lookup' AND EXISTS (
	SELECT 1 FROM "auditlogs" l WHERE l.action = 'passport.lookup' AND l.outcome = 'success'
		AND l.target = "auditlogs".target AND l.at <= "auditlogs".at AND l.at > "auditlogs".at - interval '2 minutes'))`;

const SCANS = `"auditlogs" WHERE action IN ${VERIFY_ACTIONS} AND outcome = 'success' AND NOT ${FOLLOW_UP}`;

// Admin decisions are audited as admin.respuesta with meta.estado; target is the Usuario id.
const DECISIONS = `SELECT target, at, meta->>'estado' AS estado FROM "auditlogs"
	WHERE action = 'admin.respuesta' AND meta->>'estado' IN ('aceptado', 'rechazado')`;

const QUERIES = {
	funnel: `/* stats:funnel */
		SELECT to_char(date_trunc('month', m), 'YYYY-MM') AS mes, etapa, COUNT(*)::int AS n FROM (
			SELECT "fechaCreacion" AS m, 'borradores' AS etapa FROM "usuarios" WHERE "fechaCreacion" IS NOT NULL AND ${inRange('"fechaCreacion"')}
			UNION ALL
			SELECT "fechaEnvio", 'enviadas' FROM "usuarios" WHERE "fechaEnvio" IS NOT NULL AND ${inRange('"fechaEnvio"')}
			UNION ALL
			SELECT at, CASE WHEN estado = 'aceptado' THEN 'aceptadas' ELSE 'rechazadas' END FROM (${DECISIONS}) d WHERE ${inRange('at')}
		) x GROUP BY 1, 2 ORDER BY 1`,

	review: `/* stats:review */
		WITH last AS (SELECT DISTINCT ON (target) target, at FROM (${DECISIONS}) d ORDER BY target, at DESC),
		dias AS (
			SELECT EXTRACT(EPOCH FROM (last.at - u."fechaEnvio")) / 86400 AS d
			FROM last JOIN "usuarios" u ON u.id = last.target
			WHERE u."fechaEnvio" IS NOT NULL AND last.at >= u."fechaEnvio" AND ${inRange('last.at')}
		)
		SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS mediana,
			percentile_cont(0.9) WITHIN GROUP (ORDER BY d) AS p90,
			COUNT(*)::int AS decisiones,
			(SELECT COUNT(*)::int FROM "usuarios" WHERE estado IN ('pendiente', 'revision')) AS pendientes
		FROM dias`,

	weekly: `/* stats:weekly */
		SELECT to_char(date_trunc('week', at), 'YYYY-MM-DD') AS semana, action, outcome, COUNT(*)::int AS n
		FROM "auditlogs" WHERE action IN ${VERIFY_ACTIONS} AND NOT ${FOLLOW_UP} AND ${inRange('at')}
		GROUP BY 1, 2, 3 ORDER BY 1`,

	monthly: `/* stats:monthly */
		SELECT to_char(date_trunc('month', at), 'YYYY-MM') AS mes, COUNT(*)::int AS n
		FROM ${SCANS} AND ${inRange('at')} GROUP BY 1 ORDER BY 1`,

	countries: `/* stats:countries */
		SELECT meta->>'country' AS pais, COUNT(*)::int AS n FROM ${SCANS} AND ${inRange('at')} GROUP BY 1`,

	devices: `/* stats:devices */
		SELECT meta->>'device' AS dispositivo, COUNT(*)::int AS n FROM ${SCANS} AND ${inRange('at')} GROUP BY 1`,

	// Scans per accepted passport, bucketed; the passport itself never leaves the query.
	passports: `/* stats:passports */
		WITH s AS (
			SELECT target, COUNT(*) AS n, COUNT(DISTINCT meta->>'country') AS paises
			FROM ${SCANS} AND ${inRange('at')} GROUP BY target
		)
		SELECT CASE WHEN s.n IS NULL THEN '0' WHEN s.n = 1 THEN '1' WHEN s.n <= 5 THEN '2-5' WHEN s.n <= 20 THEN '6-20' ELSE '21+' END AS tramo,
			COUNT(*)::int AS n, COALESCE(MAX(s.paises), 0)::int AS max_paises
		FROM "usuarios" u LEFT JOIN s ON s.target = u."numeroPasaporte"::text
		WHERE u.estado = 'aceptado' AND u."numeroPasaporte" >= 1000
		GROUP BY 1`,

	firstScan: `/* stats:firstScan */
		WITH ap AS (SELECT DISTINCT ON (target) target, at FROM (${DECISIONS}) d WHERE estado = 'aceptado' ORDER BY target, at DESC),
		fs AS (SELECT target, MIN(at) AS at FROM ${SCANS} GROUP BY target)
		SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fs.at - ap.at)) / 86400) AS mediana, COUNT(*)::int AS n
		FROM ap JOIN "usuarios" u ON u.id = ap.target JOIN fs ON fs.target = u."numeroPasaporte"::text
		WHERE u.estado = 'aceptado' AND fs.at >= ap.at AND ${inRange('ap.at')}`,

	holders: `/* stats:holders */
		SELECT "paisResidencia" AS pais, COUNT(*)::int AS n FROM "usuarios" WHERE estado = 'aceptado' GROUP BY 1`,

	diagnoses: `/* stats:diagnoses */
		SELECT COUNT(*)::int AS total,
			${DIAGNOSES.map(d => `COUNT(*) FILTER (WHERE "${d}")::int AS "${d}"`).join(', ')},
			COUNT(*) FILTER (WHERE "esTutor")::int AS tutor
		FROM "usuarios" WHERE estado = 'aceptado'`,

	verifiers: `/* stats:verifiers */
		SELECT v.nombre, v.activo, v."ultimoUso", COUNT(a.id)::int AS consultas
		FROM "verifiers" v LEFT JOIN "auditlogs" a ON a."actorId" = v.id AND a.action = 'passport.lookup' AND ${inRange('a.at')}
		GROUP BY v.id, v.nombre, v.activo, v."ultimoUso" ORDER BY consultas DESC, v.nombre`,

	busiestDay: `/* stats:busiestDay */
		SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS dia, COUNT(*)::int AS n
		FROM ${SCANS} AND ${inRange('at')} GROUP BY 1 ORDER BY 2 DESC, 1 DESC LIMIT 1`,

	// Takes one parameter, $1 = start of the current calendar month (not the requested range).
	verifierOfMonth: `/* stats:verifierOfMonth */
		SELECT v.nombre, COUNT(*)::int AS consultas
		FROM "auditlogs" a JOIN "verifiers" v ON v.id = a."actorId"
		WHERE a.action = 'passport.lookup' AND a.outcome = 'success' AND a.at >= $1::timestamptz
		GROUP BY v.id, v.nombre ORDER BY 2 DESC, 1 LIMIT 1`,
};

// Current totals over accepted holders, independent of the requested range.
const UNRANGED = ['holders', 'diagnoses'];

const num = v => (v == null ? null : Number(v));
const round1 = v => (v == null ? null : Math.round(Number(v) * 10) / 10);
const share = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 1000 : null);

// [{ [key]: label, n }] -> sorted desc, buckets under MIN_BUCKET merged into a final 'Otros'.
const mergeSmall = (rows, key, emptyLabel) => {
	const kept = [];
	let otros = 0;
	for (const row of rows) {
		const n = num(row.n) || 0;
		if (n === 0) continue;
		const label = row[key] == null || row[key] === '' ? emptyLabel : row[key];
		if (n < MIN_BUCKET || label === OTROS) otros += n;
		else kept.push({ [key]: label, n });
	}
	kept.sort((a, b) => b.n - a.n || String(a[key]).localeCompare(String(b[key])));
	if (otros > 0) kept.push({ [key]: OTROS, n: otros });
	return kept;
};

const byPeriod = (rows, periodKey, init) => {
	const map = new Map();
	for (const row of rows) {
		if (!map.has(row[periodKey])) map.set(row[periodKey], { [periodKey]: row[periodKey], ...init() });
	}
	return map;
};

const funnel = rows => {
	const stages = () => ({ borradores: 0, enviadas: 0, aceptadas: 0, rechazadas: 0 });
	const months = byPeriod(rows, 'mes', stages);
	const totales = stages();
	for (const row of rows) {
		months.get(row.mes)[row.etapa] += num(row.n);
		totales[row.etapa] += num(row.n);
	}
	return { totales, porMes: [...months.values()] };
};

const weekly = rows => {
	const weeks = byPeriod(rows, 'semana', () => ({ qr: 0, enlace: 0, verificador: 0, exitosos: 0, fallidos: 0 }));
	const failures = byPeriod(rows, 'semana', () => Object.fromEntries(FAILURES.map(f => [f, 0])));
	const porTipo = { qr: 0, enlace: 0, verificador: 0 };
	const exitososPorTipo = { qr: 0, enlace: 0, verificador: 0 };
	for (const row of rows) {
		const n = num(row.n);
		const kind = KIND[row.action];
		const week = weeks.get(row.semana);
		week[kind] += n;
		porTipo[kind] += n;
		if (row.outcome === 'success') {
			week.exitosos += n;
			exitososPorTipo[kind] += n;
		} else {
			week.fallidos += n;
			if (FAILURES.includes(row.outcome)) failures.get(row.semana)[row.outcome] += n;
		}
	}
	const fallosPorSemana = [...failures.values()].filter(w => FAILURES.some(f => w[f] > 0));
	return { porSemana: [...weeks.values()], fallosPorSemana, porTipo, exitososPorTipo };
};

const passports = rows => {
	const order = ['0', '1', '2-5', '6-20', '21+'];
	const sorted = [...rows].sort((a, b) => order.indexOf(a.tramo) - order.indexOf(b.tramo));
	const aceptados = sorted.reduce((sum, r) => sum + num(r.n), 0);
	const sinEscaneos = num((sorted.find(r => r.tramo === '0') || {}).n) || 0;
	return {
		aceptados,
		activos: aceptados - sinEscaneos,
		cuotaActivos: share(aceptados - sinEscaneos, aceptados),
		distribucion: mergeSmall(sorted, 'tramo').sort((a, b) => {
			const ia = a.tramo === OTROS ? order.length : order.indexOf(a.tramo);
			const ib = b.tramo === OTROS ? order.length : order.indexOf(b.tramo);
			return ia - ib;
		}),
		maxPaises: sorted.reduce((max, r) => Math.max(max, num(r.max_paises) || 0), 0),
	};
};

const startOfMonth = now => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// range: { desde: Date|null, hasta: Date|null (exclusive) }.
const getStats = async (range, now = new Date()) => {
	const prisma = getPrisma();
	const params = [range.desde || null, range.hasta || null];
	const names = Object.keys(QUERIES);
	const paramsFor = name => (UNRANGED.includes(name) ? [] : name === 'verifierOfMonth' ? [startOfMonth(now)] : params);
	const results = await Promise.all(names.map(name => prisma.$queryRawUnsafe(QUERIES[name], ...paramsFor(name))));
	const r = Object.fromEntries(names.map((name, i) => [name, results[i]]));

	const scans = weekly(r.weekly);
	const review = r.review[0] || {};
	const firstScan = r.firstScan[0] || {};
	const diag = r.diagnoses[0] || {};
	const titulares = num(diag.total) || 0;
	const pass = passports(r.passports);
	const countries = r.countries.filter(c => c.pais);
	const day = r.busiestDay[0];
	const topVerifier = r.verifierOfMonth[0];
	const qrOrLink = scans.exitososPorTipo.qr + scans.exitososPorTipo.enlace;

	return {
		registro: funnel(r.funnel),
		revision: {
			medianaDias: round1(review.mediana),
			p90Dias: round1(review.p90),
			decisiones: num(review.decisiones) || 0,
			pendientes: num(review.pendientes) || 0,
		},
		escaneos: {
			total: r.monthly.reduce((sum, m) => sum + num(m.n), 0),
			porTipo: scans.porTipo,
			porSemana: scans.porSemana,
			fallosPorSemana: scans.fallosPorSemana,
			porMes: r.monthly.map(m => ({ mes: m.mes, n: num(m.n) })),
			porPais: mergeSmall(r.countries, 'pais', 'Desconocido'),
			porDispositivo: mergeSmall(r.devices, 'dispositivo', 'other'),
			cuotaEnlaceAntiguo: share(scans.exitososPorTipo.enlace, qrOrLink),
		},
		pasaportes: {
			aceptados: pass.aceptados,
			activos: pass.activos,
			cuotaActivos: pass.cuotaActivos,
			distribucionEscaneos: pass.distribucion,
			medianaDiasHastaPrimerEscaneo: round1(firstScan.mediana),
		},
		titulares: {
			total: titulares,
			porPais: mergeSmall(r.holders, 'pais', 'Sin dato'),
			diagnostico: mergeSmall(DIAGNOSES.map(d => ({ diagnostico: d, n: diag[d] })), 'diagnostico'),
			tutor: num(diag.tutor) || 0,
			cuotaTutor: share(num(diag.tutor) || 0, titulares),
		},
		verificadores: r.verifiers.map(v => ({
			nombre: v.nombre,
			activo: v.activo !== false,
			consultas: num(v.consultas),
			ultimoUso: v.ultimoUso || null,
		})),
		curiosidades: {
			paisesConEscaneos: countries.length,
			diaMasActivo: day ? { dia: day.dia, n: num(day.n) } : null,
			verificadorDelMes: topVerifier ? { nombre: topVerifier.nombre, consultas: num(topVerifier.consultas) } : null,
			maxPaisesUnPasaporte: pass.maxPaises,
		},
	};
};

module.exports = { getStats, QUERIES };
