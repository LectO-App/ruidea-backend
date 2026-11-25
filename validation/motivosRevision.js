// Reasons a specialist can pick when sending an application back for revision. The single
// source of truth: the admin decision accepts only these ids, the revision email lists their
// applicant titles, and the front end keeps the same list (ruidea-frontend
// src/util/motivosRevision.js: ids, groups, admin titles, titles and tips must match).
// - admin: what the specialist reads in the review modal.
// - titulo: what the applicant reads, an action ("Sube otra foto del informe").
// - consejo: a short tip under the title.
// Each reason belongs to the form step (grupo) the applicant opens to fix it.
const GRUPOS = ['datos', 'residencia', 'diagnostico', 'documentos'];

// The longest text a specialist can write for an "Otro" reason.
const OTRO_MAX = 140;

const MOTIVOS = [
	{ id: 'informe-ilegible', grupo: 'documentos', admin: 'El informe no se lee bien', titulo: 'Sube otra foto del informe', consejo: 'Con buena luz y la hoja entera.' },
	{ id: 'informe-incompleto', grupo: 'documentos', admin: 'Falta una parte del informe', titulo: 'Sube todas las páginas del informe', consejo: 'También la de la firma.' },
	{ id: 'documento-identidad', grupo: 'documentos', admin: 'No se ve bien tu documento de identidad', titulo: 'Sube otra foto de tu documento', consejo: 'Las dos caras, sin reflejos.' },
	{ id: 'diagnostico-no-coincide', grupo: 'diagnostico', admin: 'El diagnóstico no coincide con el informe', titulo: 'Revisa el diagnóstico', consejo: 'Marca solo lo que dice el informe.' },
	{ id: 'nombre-no-coincide', grupo: 'datos', admin: 'El nombre no coincide con el documento', titulo: 'Escribe el nombre como en el documento', consejo: 'Nombre y apellidos completos.' },
	{ id: 'fecha-nacimiento', grupo: 'datos', admin: 'Revisa la fecha de nacimiento', titulo: 'Revisa la fecha de nacimiento', consejo: 'Cópiala del documento.' },
	{ id: 'datos-tutor', grupo: 'datos', admin: 'Faltan los datos de quien hace la solicitud', titulo: 'Añade tus datos como tutor', consejo: 'Tu nombre y tu relación con el menor.' },
	{ id: 'numero-documento', grupo: 'residencia', admin: 'El número de documento no coincide', titulo: 'Revisa el número de documento', consejo: 'Cópialo igual, con la letra.' },
	// One "Otro" reason per step, for anything the list above doesn't name. It has no fixed
	// title or tip: the specialist writes its text (textosOtro, at most OTRO_MAX characters),
	// and the applicant reads that text as the title.
	{ id: 'otro-datos', grupo: 'datos', admin: 'Otro cambio en Datos personales', otro: true },
	{ id: 'otro-residencia', grupo: 'residencia', admin: 'Otro cambio en Residencia y documento', otro: true },
	{ id: 'otro-diagnostico', grupo: 'diagnostico', admin: 'Otro cambio en Diagnóstico', otro: true },
	{ id: 'otro-documentos', grupo: 'documentos', admin: 'Otro cambio en Documentos', otro: true },
];

const MOTIVO_IDS = MOTIVOS.map(m => m.id);
const OTRO_IDS = MOTIVOS.filter(m => m.otro).map(m => m.id);
const BY_ID = new Map(MOTIVOS.map(m => [m.id, m]));

const motivoById = id => BY_ID.get(id);
const isOtro = id => Boolean(BY_ID.get(id) && BY_ID.get(id).otro);

module.exports = { GRUPOS, MOTIVOS, MOTIVO_IDS, OTRO_IDS, OTRO_MAX, motivoById, isOtro };
