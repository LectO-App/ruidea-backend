const { GRUPOS } = require('../validation/motivosRevision');

// Application fields of each revision group (the form step that edits them).
const FIELDS_BY_GRUPO = {
	datos: ['nombre', 'apellidos', 'fechaNacimiento', 'esTutor', 'tutorNombre', 'tutorApellidos', 'tutorParentesco'],
	residencia: ['paisResidencia', 'localidadResidencia', 'lugarNacimiento', 'tipoDocumento', 'numeroDocumento', 'numeroTelefono'],
};
const DIAGNOSTICO_KEYS = ['dislexia', 'discalculia', 'disortografía', 'dispraxia', 'tdah'];

// null, undefined, '' and false all mean "not set".
const norm = v => {
	if (v instanceof Date) return v.getTime();
	if (v == null || v === false || v === '') return '';
	return String(v);
};

const differs = (a, b) => norm(a) !== norm(b);

// Groups whose fields differ between the stored record and the values about to be saved.
// Only keys present in `next` are compared.
const changedGroups = (current, next) => {
	const out = [];
	for (const [grupo, fields] of Object.entries(FIELDS_BY_GRUPO)) {
		if (fields.some(f => f in next && differs(current[f], next[f]))) out.push(grupo);
	}
	if (next.diagnostico) {
		const before = current.diagnostico || {};
		if (DIAGNOSTICO_KEYS.some(k => Boolean(before[k]) !== Boolean(next.diagnostico[k]))) out.push('diagnostico');
	}
	return out;
};

// The record's cambiosDesdeRevision plus `groups`, in catalog order.
const withCambios = (current, groups) => {
	const set = new Set([...(current.cambiosDesdeRevision || []), ...groups]);
	return GRUPOS.filter(g => set.has(g));
};

module.exports = { changedGroups, withCambios };
