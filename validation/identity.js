// Identity / contact normalisers and validators shared by the Zod schemas and any
// route that needs to sanity-check user input. Pure functions, no I/O — so they are
// trivially unit-testable and safe to run on both the draft (lenient) and submit
// (strict) paths.
//
// Rationale (REGISTRATION_UX.md §3, §8): catch a wrong DNI check-letter or an
// unparseable phone at registration time — with a kind, specific message — instead of
// at medical-review rejection, and store phones in a single canonical (E.164) shape.

const { parsePhoneNumberFromString } = require('libphonenumber-js');

// ---------------------------------------------------------------------------
// Spanish national ID documents
// ---------------------------------------------------------------------------

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

// DNI: 8 digits + control letter. The letter is digits % 23 indexed into the table.
const isValidDni = value => {
	const m = /^(\d{8})([A-Z])$/.exec(String(value).trim().toUpperCase());
	if (!m) return false;
	return DNI_LETTERS[parseInt(m[1], 10) % 23] === m[2];
};

// NIE: leading X/Y/Z (→ 0/1/2) + 7 digits + control letter, same check table.
const isValidNie = value => {
	const m = /^([XYZ])(\d{7})([A-Z])$/.exec(String(value).trim().toUpperCase());
	if (!m) return false;
	const prefix = { X: '0', Y: '1', Z: '2' }[m[1]];
	return DNI_LETTERS[parseInt(prefix + m[2], 10) % 23] === m[3];
};

// Passport: we cannot checksum every country's passport, so we only enforce a sane
// alphanumeric shape and leave deeper validation to the human reviewer + document upload.
const isValidPassport = value => /^[A-Z0-9]{5,20}$/.test(String(value).trim().toUpperCase());

// Only SPANISH documents carry the DNI/NIE check letter. RUIDEA serves all of
// Iberoamerica, where a "DNI" is typically just digits (e.g. an Argentine DNI like
// 45570422). So we only apply the strict checksum when the country is Spain; everywhere
// else we accept any reasonable document string and leave deeper checks to the human
// reviewer + the uploaded document (§3). `pais` is paisResidencia.
const isSpanishDoc = pais => pais === 'España';

const isValidDocumento = (tipo, value, pais) => {
	const v = String(value || '').trim();
	if (!v) return false;
	if (!isSpanishDoc(pais)) return v.length >= 4 && v.length <= 60;
	switch (tipo) {
		case 'dni':
			return isValidDni(v);
		case 'nie':
			return isValidNie(v);
		case 'pasaporte':
			return isValidPassport(v);
		default:
			return v.length >= 1 && v.length <= 60;
	}
};

const normalizeDocumento = value => String(value || '').trim().toUpperCase();

// ---------------------------------------------------------------------------
// Phone — store one canonical E.164 shape regardless of how the user typed it
// ---------------------------------------------------------------------------

// Accepts "600123123", "600 12 31 23", "+34 600123123", etc. Defaults to Spain (ES)
// when no country code is present. Returns E.164 ("+34600123123") or null if invalid.
const normalizePhone = (value, defaultCountry = 'ES') => {
	if (!value) return null;
	const parsed = parsePhoneNumberFromString(String(value).trim(), defaultCountry);
	return parsed && parsed.isValid() ? parsed.number : null;
};

// ---------------------------------------------------------------------------
// Email — typo suggestion ("juan@gmial.com" → "juan@gmail.com")
// ---------------------------------------------------------------------------

const COMMON_DOMAINS = [
	'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es',
	'hotmail.es', 'outlook.es', 'live.com', 'icloud.com', 'protonmail.com',
];

const levenshtein = (a, b) => {
	const m = a.length;
	const n = b.length;
	const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
	for (let j = 0; j <= n; j++) d[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
		}
	}
	return d[m][n];
};

// Returns a suggested corrected address, or null if the domain already looks fine /
// no close match exists. The frontend surfaces this as "¿Quisiste decir …?" (§3).
const suggestEmail = email => {
	const value = String(email || '').trim().toLowerCase();
	const at = value.lastIndexOf('@');
	if (at < 1) return null;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	if (!domain || COMMON_DOMAINS.includes(domain)) return null;
	let best = null;
	let bestDist = Infinity;
	for (const candidate of COMMON_DOMAINS) {
		const dist = levenshtein(domain, candidate);
		if (dist < bestDist) {
			bestDist = dist;
			best = candidate;
		}
	}
	// Only suggest for near-misses (1–2 edits); further away is probably a real domain.
	return best && bestDist > 0 && bestDist <= 2 ? `${local}@${best}` : null;
};

module.exports = {
	isValidDni,
	isValidNie,
	isValidPassport,
	isValidDocumento,
	normalizeDocumento,
	normalizePhone,
	suggestEmail,
};
