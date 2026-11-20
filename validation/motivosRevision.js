// Reasons a specialist can pick when sending an application back for revision. The single
// source of truth: the admin decision accepts only these ids, the revision email lists their
// titles, and the front end shows a matching map of titles and tips
// (ruidea-frontend src/util/motivosRevision.js). Each reason belongs to the form step
// (grupo) the applicant opens to fix it.
const GRUPOS = ['datos', 'residencia', 'diagnostico', 'documentos'];

const MOTIVOS = [
	{ id: 'informe-ilegible', grupo: 'documentos', titulo: 'El informe no se lee bien' },
	{ id: 'informe-incompleto', grupo: 'documentos', titulo: 'Falta una parte del informe' },
	{ id: 'documento-identidad', grupo: 'documentos', titulo: 'No se ve bien tu documento de identidad' },
	{ id: 'diagnostico-no-coincide', grupo: 'diagnostico', titulo: 'El diagnóstico no coincide con el informe' },
	{ id: 'nombre-no-coincide', grupo: 'datos', titulo: 'El nombre no coincide con el documento' },
	{ id: 'fecha-nacimiento', grupo: 'datos', titulo: 'Revisa la fecha de nacimiento' },
	{ id: 'datos-tutor', grupo: 'datos', titulo: 'Faltan los datos de quien hace la solicitud' },
	{ id: 'numero-documento', grupo: 'residencia', titulo: 'El número de documento no coincide' },
	// One "Otro" reason per step, for anything the list above doesn't name. The specialist's
	// note says what to change, so an "Otro" reason needs a note (validation/schemas.js).
	{ id: 'otro-datos', grupo: 'datos', titulo: 'Otro cambio en Datos personales', otro: true },
	{ id: 'otro-residencia', grupo: 'residencia', titulo: 'Otro cambio en Residencia y documento', otro: true },
	{ id: 'otro-diagnostico', grupo: 'diagnostico', titulo: 'Otro cambio en Diagnóstico', otro: true },
	{ id: 'otro-documentos', grupo: 'documentos', titulo: 'Otro cambio en Documentos', otro: true },
];

const MOTIVO_IDS = MOTIVOS.map(m => m.id);
const BY_ID = new Map(MOTIVOS.map(m => [m.id, m]));

const motivoById = id => BY_ID.get(id);
const isOtro = id => Boolean(BY_ID.get(id) && BY_ID.get(id).otro);

module.exports = { GRUPOS, MOTIVOS, MOTIVO_IDS, motivoById, isOtro };
