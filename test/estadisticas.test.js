const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

// GET /admin/estadisticas against a stand-in for the Prisma client: each aggregate query is
// answered with canned rows (the SQL itself runs only on a real database). All data is synthetic.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

const calls = [];
let rows = {};
let failWith = null;
const fake = {
	$queryRawUnsafe: async (sql, ...params) => {
		const name = /\/\* stats:(\w+) \*\//.exec(sql)[1];
		calls.push({ name, sql, params });
		if (failWith) throw failWith;
		return rows[name] || [];
	},
	auditLog: { create: async () => ({}) },
};
require('../db/prisma').getPrisma = () => fake;

const express = require('express');
const cookieParser = require('cookie-parser');
const { signToken } = require('../functions/tokens');
const { QUERIES } = require('../functions/stats');

const csrf = 'c'.repeat(64);
const adminCookie = `token=${signToken({ id: 'admin', role: 'admin', csrf }, { expiresIn: '1h' })}`;
const userCookie = `token=${signToken({ id: 'a'.repeat(24), role: 'user', csrf, tv: 0 }, { expiresIn: '1h' })}`;

let server;
let base;
before(async () => {
	const app = express();
	app.use(cookieParser());
	app.use('/admin', require('../routes/admin'));
	await new Promise(resolve => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());
beforeEach(() => {
	calls.length = 0;
	rows = {};
	failWith = null;
});

const get = async (query = '', cookie = adminCookie) => {
	const res = await fetch(`${base}/admin/estadisticas${query}`, { headers: cookie ? { cookie } : {} });
	return { status: res.status, body: await res.json() };
};

const SAMPLE = {
	funnel: [
		{ mes: '2026-09', etapa: 'borradores', n: 12 },
		{ mes: '2026-09', etapa: 'enviadas', n: 8 },
		{ mes: '2026-10', etapa: 'enviadas', n: 3 },
		{ mes: '2026-10', etapa: 'aceptadas', n: 6 },
		{ mes: '2026-10', etapa: 'rechazadas', n: 1 },
	],
	review: [{ mediana: 3.26, p90: 11.04, decisiones: 7, pendientes: 4 }],
	weekly: [
		{ semana: '2026-10-05', action: 'passport.verify_token', outcome: 'success', n: 9 },
		{ semana: '2026-10-05', action: 'passport.verify_link', outcome: 'success', n: 3 },
		{ semana: '2026-10-05', action: 'passport.lookup', outcome: 'document_mismatch', n: 2 },
		{ semana: '2026-10-12', action: 'passport.verify_link', outcome: 'legacy_disabled', n: 1 },
		{ semana: '2026-10-12', action: 'passport.lookup', outcome: 'success', n: 4 },
	],
	monthly: [{ mes: '2026-10', n: 16 }],
	countries: [
		{ pais: 'AR', n: 9 },
		{ pais: 'ES', n: 5 },
		{ pais: 'UY', n: 1 },
		{ pais: 'CL', n: 2 },
		{ pais: null, n: 1 },
	],
	devices: [
		{ dispositivo: 'mobile', n: 12 },
		{ dispositivo: 'desktop', n: 4 },
	],
	passports: [
		{ tramo: '2-5', n: 6, max_paises: 3 },
		{ tramo: '0', n: 7, max_paises: 0 },
		{ tramo: '1', n: 5, max_paises: 1 },
		{ tramo: '21+', n: 1, max_paises: 2 },
	],
	firstScan: [{ mediana: 4.44, n: 11 }],
	holders: [
		{ pais: 'Argentina', n: 10 },
		{ pais: 'España', n: 6 },
		{ pais: 'Andorra', n: 1 },
		{ pais: null, n: 2 },
	],
	diagnoses: [{ total: 19, dislexia: 15, discalculia: 6, disortografia: 2, dispraxia: 0, tdah: 3, tutor: 12 }],
	verifiers: [
		{ nombre: 'Colegio Ejemplo', activo: true, ultimoUso: new Date('2026-10-14T10:00:00Z'), consultas: 4 },
		{ nombre: 'Universidad Ficticia', activo: false, ultimoUso: null, consultas: 0 },
	],
	busiestDay: [{ dia: '2026-10-06', n: 7 }],
	verifierOfMonth: [{ nombre: 'Colegio Ejemplo', consultas: 4 }],
};

test('only an admin session can read the statistics', async () => {
	assert.equal((await get('', null)).status, 401);
	assert.equal((await get('', userCookie)).status, 403);
	assert.equal(calls.length, 0);
});

test('aggregates come back in the documented shape', async () => {
	rows = SAMPLE;
	const { status, body } = await get();
	assert.equal(status, 200);
	assert.deepEqual(body.rango, { desde: null, hasta: null });
	assert.deepEqual(body.registro.totales, { borradores: 12, enviadas: 11, aceptadas: 6, rechazadas: 1 });
	assert.deepEqual(body.registro.porMes[1], { mes: '2026-10', borradores: 0, enviadas: 3, aceptadas: 6, rechazadas: 1 });
	assert.deepEqual(body.revision, { medianaDias: 3.3, p90Dias: 11, decisiones: 7, pendientes: 4 });
	assert.deepEqual(body.escaneos.porSemana, [
		{ semana: '2026-10-05', qr: 9, enlace: 3, verificador: 2, exitosos: 12, fallidos: 2 },
		{ semana: '2026-10-12', qr: 0, enlace: 1, verificador: 4, exitosos: 4, fallidos: 1 },
	]);
	assert.deepEqual(body.escaneos.fallosPorSemana, [
		{ semana: '2026-10-05', not_found: 0, document_mismatch: 2, denied: 0, legacy_disabled: 0 },
		{ semana: '2026-10-12', not_found: 0, document_mismatch: 0, denied: 0, legacy_disabled: 1 },
	]);
	assert.equal(body.escaneos.total, 16);
	assert.equal(body.escaneos.cuotaEnlaceAntiguo, 0.25);
	assert.deepEqual(body.pasaportes, {
		aceptados: 19,
		activos: 12,
		cuotaActivos: 0.632,
		distribucionEscaneos: [
			{ tramo: '0', n: 7 },
			{ tramo: '1', n: 5 },
			{ tramo: '2-5', n: 6 },
			{ tramo: 'Otros', n: 1 },
		],
		medianaDiasHastaPrimerEscaneo: 4.4,
	});
	assert.deepEqual(body.titulares.diagnostico, [
		{ diagnostico: 'dislexia', n: 15 },
		{ diagnostico: 'discalculia', n: 6 },
		{ diagnostico: 'Otros', n: 5 },
	]);
	assert.equal(body.titulares.cuotaTutor, 0.632);
	assert.deepEqual(body.verificadores[0], { nombre: 'Colegio Ejemplo', activo: true, consultas: 4, ultimoUso: '2026-10-14T10:00:00.000Z' });
	assert.deepEqual(body.curiosidades, {
		paisesConEscaneos: 4,
		diaMasActivo: { dia: '2026-10-06', n: 7 },
		verificadorDelMes: { nombre: 'Colegio Ejemplo', consultas: 4 },
		maxPaisesUnPasaporte: 3,
	});
});

test('countries and other buckets under 5 are merged into Otros', async () => {
	rows = SAMPLE;
	const { body } = await get();
	assert.deepEqual(body.escaneos.porPais, [
		{ pais: 'AR', n: 9 },
		{ pais: 'ES', n: 5 },
		{ pais: 'Otros', n: 4 },
	]);
	assert.deepEqual(body.titulares.porPais, [
		{ pais: 'Argentina', n: 10 },
		{ pais: 'España', n: 6 },
		{ pais: 'Otros', n: 3 },
	]);
	assert.deepEqual(body.escaneos.porDispositivo, [{ dispositivo: 'mobile', n: 12 }, { dispositivo: 'Otros', n: 4 }]);
});

test('no query reads personal columns and no answer lists passports', async () => {
	rows = SAMPLE;
	const { body } = await get();
	for (const sql of Object.values(QUERIES)) {
		for (const column of ['numeroDocumento', 'apellidos', 'correoElectronico', 'numeroTelefono', 'shareToken', 'fechaNacimiento', '.ip', ' ip,']) {
			assert.equal(sql.includes(column), false, column);
		}
	}
	const json = JSON.stringify(body);
	assert.doesNotMatch(json, /numeroPasaporte|target|"ip"/);
});

test('the page a verifier check opens is not counted again as a scan', () => {
	const followUp = /action <> 'passport\.lookup' AND EXISTS \(\s*SELECT 1 FROM "auditlogs" l WHERE l\.action = 'passport\.lookup' AND l\.outcome = 'success'\s*AND l\.target = "auditlogs"\.target AND l\.at <= "auditlogs"\.at AND l\.at > "auditlogs"\.at - interval '2 minutes'/;
	for (const name of ['weekly', 'monthly', 'countries', 'devices', 'passports', 'firstScan', 'busiestDay']) {
		assert.match(QUERIES[name], /AND NOT \(action <> 'passport\.lookup'/, name);
		assert.match(QUERIES[name], followUp, name);
	}
});

test('an empty database answers zeros and empty lists', async () => {
	const { status, body } = await get();
	assert.equal(status, 200);
	assert.equal(body.escaneos.total, 0);
	assert.deepEqual(body.escaneos.porPais, []);
	assert.equal(body.escaneos.cuotaEnlaceAntiguo, null);
	assert.equal(body.revision.medianaDias, null);
	assert.equal(body.pasaportes.cuotaActivos, null);
	assert.equal(body.curiosidades.diaMasActivo, null);
	assert.equal(body.curiosidades.verificadorDelMes, null);
});

test('desde and hasta become an inclusive UTC day range', async () => {
	const { status, body } = await get('?desde=2026-10-01&hasta=2026-10-31');
	assert.equal(status, 200);
	assert.deepEqual(body.rango, { desde: '2026-10-01', hasta: '2026-10-31' });
	const weekly = calls.find(c => c.name === 'weekly');
	assert.deepEqual(weekly.params.map(d => d.toISOString()), ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
	assert.deepEqual(calls.find(c => c.name === 'holders').params, []);
	assert.equal(calls.find(c => c.name === 'verifierOfMonth').params.length, 1);
	const open = await get('?desde=2026-10-01');
	assert.equal(open.status, 200);
	assert.equal(calls.filter(c => c.name === 'weekly')[1].params[1], null);
});

test('a malformed or reversed range is a 400', async () => {
	for (const q of ['?desde=01/10/2026', '?hasta=2026-02-30', '?desde=2026-10-31&hasta=2026-10-01', '?desde=2026-10-01%27%3B']) {
		const r = await get(q);
		assert.equal(r.status, 400, q);
		assert.equal(r.body.message, 'Datos inválidos');
	}
	assert.equal(calls.length, 0);
});

test('a database failure is a generic 500', async () => {
	failWith = Object.assign(new Error('connection refused'), { code: 'P1001' });
	const r = await get();
	assert.equal(r.status, 500);
	assert.deepEqual(r.body, { message: 'No se pudieron calcular las estadísticas' });
});
