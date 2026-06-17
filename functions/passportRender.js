const crypto = require('crypto');
const { withPage } = require('./browser');
const { passportHtml } = require('./passportTemplate');
const logger = require('./logger');

// Renders + caches passport documents. The HTML is fully self-contained (inlined
// assets + font), so we feed it straight to the page via setContent — no HTTP route
// serving PII, no render token, no external fetch (SECURITY_ASSESSMENT.md §2.3).

const CACHE = new Map(); // key -> Buffer (LRU via insertion order)
const INFLIGHT = new Map(); // key -> Promise<Buffer> (dedupe concurrent renders)
const MAX = 200;

// Version hash over every field that affects the rendered document, so an admin edit
// yields a new cache key (and stale entries fall off via the LRU cap).
const versionOf = u =>
	crypto
		.createHash('sha1')
		.update(
			JSON.stringify({
				n: u.nombre,
				a: u.apellidos,
				p: u.paisResidencia,
				d: u.numeroDocumento,
				f: u.fechaNacimiento,
				np: u.numeroPasaporte,
				dg: u.diagnostico,
			})
		)
		.digest('hex')
		.slice(0, 16);

const keyOf = (user, type) => `${user._id}:${type}:${versionOf(user)}`;

const renderToBuffer = async (user, type) => {
	const html = await passportHtml(user);
	const buf = await withPage(async page => {
		await page.setViewport({ width: 1000, height: 590, deviceScaleFactor: 2 });
		await page.setContent(html, { waitUntil: 'networkidle0' });
		await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
		if (type === 'pdf') {
			return page.pdf({ width: '1000px', height: '590px', printBackground: true, pageRanges: '1' });
		}
		return page.screenshot({ type: 'jpeg', quality: 100 });
	});
	return Buffer.from(buf); // Puppeteer 23 returns Uint8Array; Express needs a Buffer
};

// Returns { buffer, cached }. Concurrent calls for the same key share one render.
const getPassport = async (user, type) => {
	const key = keyOf(user, type);

	const hit = CACHE.get(key);
	if (hit) {
		CACHE.delete(key);
		CACHE.set(key, hit); // bump LRU recency
		return { buffer: hit, cached: true };
	}

	if (INFLIGHT.has(key)) return { buffer: await INFLIGHT.get(key), cached: false };

	const promise = renderToBuffer(user, type);
	INFLIGHT.set(key, promise);
	try {
		const buffer = await promise;
		CACHE.set(key, buffer);
		if (CACHE.size > MAX) CACHE.delete(CACHE.keys().next().value);
		return { buffer, cached: false };
	} finally {
		INFLIGHT.delete(key);
	}
};

// Fire-and-forget pre-render (both formats) so the first user download is instant.
const warmPassport = user => {
	['pdf', 'img'].forEach(type =>
		getPassport(user, type).catch(err => logger.warn({ err }, 'passport warm failed'))
	);
};

module.exports = { getPassport, warmPassport };
