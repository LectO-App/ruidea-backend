const { getPrisma } = require('../db/prisma');
const { PUBLIC_FIELDS } = require('./publicView');

// "Mis datos" (GET /usuario/me/datos and the export): every stored field of a holder, in plain
// Spanish, grouped, and marked by who can see it. 'enlace' groups hold only fields of the public
// passport page (publicView); 'equipo' groups hold only fields that RUIDEA's team alone sees.

const DIAGNOSTICOS = [
	['dislexia', 'Dislexia'],
	['discalculia', 'Discalculia'],
	['disortografía', 'Disortografía'],
	['dispraxia', 'Dispraxia'],
	['tdah', 'TDAH'],
];
const ESTADOS = {
	borrador: 'Sin enviar',
	pendiente: 'Enviada, esperando la revisión',
	revision: 'Necesita un cambio',
	aceptado: 'Aprobada',
	rechazado: 'Rechazada',
};
const TIPOS_DOCUMENTO = { dni: 'DNI', nie: 'NIE', pasaporte: 'Pasaporte' };
const SIN_INDICAR = 'Sin indicar';

const texto = v => (v == null || String(v).trim() === '' ? SIN_INDICAR : String(v));
const siNo = v => (v ? 'Sí' : 'No');
const fecha = v => {
	const d = v ? new Date(v) : null;
	if (!d || isNaN(d.getTime())) return SIN_INDICAR;
	const pad = n => String(n).padStart(2, '0');
	return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

const diagnosticoTexto = d => {
	const nombres = DIAGNOSTICOS.filter(([key]) => d && d[key]).map(([, nombre]) => nombre);
	return nombres.length ? nombres.join(', ') : SIN_INDICAR;
};
const pasaporteTexto = n => (Number.isInteger(n) && n >= 1000 ? String(n).padStart(7, '0') : 'Aún no emitido');

// [clave, titulo, [[field, etiqueta, format]]]
const GRUPOS = [
	['persona', 'Nombre y apellidos', [['nombre', 'Nombre', texto], ['apellidos', 'Apellidos', texto]]],
	['nacimiento', 'Fecha de nacimiento', [['fechaNacimiento', 'Fecha de nacimiento', fecha]]],
	['pais', 'País donde vives', [['paisResidencia', 'País', texto]]],
	['documento', 'Número de documento', [['numeroDocumento', 'Número', texto]]],
	['diagnostico', 'Diagnóstico', [['diagnostico', 'Diagnóstico', diagnosticoTexto]]],
	[
		'pasaporte',
		'Tu pasaporte',
		[
			['numeroPasaporte', 'Número de pasaporte', pasaporteTexto],
			['estado', 'Estado de la solicitud', v => ESTADOS[v] || SIN_INDICAR],
		],
	],
	[
		'contacto',
		'Correo y teléfono',
		[
			['correoElectronico', 'Correo', texto],
			['emailVerificado', 'Correo confirmado', siNo],
			['numeroTelefono', 'Teléfono', texto],
		],
	],
	[
		'residencia',
		'Más datos personales',
		[
			['localidadResidencia', 'Localidad donde vives', texto],
			['lugarNacimiento', 'Lugar de nacimiento', texto],
			['tipoDocumento', 'Tipo de documento', v => TIPOS_DOCUMENTO[v] || SIN_INDICAR],
		],
	],
	[
		'tutor',
		'Datos del padre, madre o tutor',
		[
			['esTutor', 'Lo gestiona un padre, madre o tutor', siNo],
			['tutorNombre', 'Nombre', texto],
			['tutorApellidos', 'Apellidos', texto],
			['tutorParentesco', 'Parentesco', texto],
		],
	],
	[
		'informe',
		'Informe y documentos',
		[['archivoBlob', 'Documentos subidos', v => (v ? 'Sí, están guardados' : 'Todavía no has subido documentos')]],
	],
	[
		'solicitud',
		'Tu solicitud',
		[
			['fechaCreacion', 'Empezada el', fecha],
			['fechaEnvio', 'Enviada el', fecha],
			['mensajeMedico', 'Mensaje del especialista', texto],
		],
	],
	[
		'permisos',
		'Lo que aceptaste',
		[
			['aceptoSolicitud', 'Aceptaste la política de privacidad', siNo],
			['fechaConsentimiento', 'Fecha en que lo aceptaste', fecha],
			['aceptoRecibirInfo', 'Noticias y novedades de DISFAM', siNo],
		],
	],
];

const PUBLIC = new Set(PUBLIC_FIELDS);

// [{ clave, titulo, visibilidad: 'enlace' | 'equipo', campos: [{ clave, etiqueta, valor }] }]
const fieldGroups = usuario =>
	GRUPOS.map(([clave, titulo, campos]) => ({
		clave,
		titulo,
		visibilidad: campos.every(([field]) => PUBLIC.has(field)) ? 'enlace' : 'equipo',
		campos: campos.map(([field, etiqueta, format]) => ({ clave: field, etiqueta, valor: format(usuario[field]) })),
	}));

const VERIFY_ACTIONS = ['passport.verify_token', 'passport.verify_link', 'passport.lookup'];
const DAY = 24 * 60 * 60 * 1000;
// A verifier check opens the public page right after it, which writes a second entry: the same
// opening, so it is counted once (as in the admin statistics, functions/stats.js).
const FOLLOW_UP = 2 * 60 * 1000;

// How often the holder's link was opened in the last 30 days: a count and the days (newest
// first, YYYY-MM-DD, UTC). Only the time of each success is read, never the IP, the verifier,
// the country or the device.
const linkOpenings = async (numeroPasaporte, now = new Date()) => {
	const rows = await getPrisma().auditLog.findMany({
		where: {
			action: { in: VERIFY_ACTIONS },
			outcome: 'success',
			target: String(numeroPasaporte),
			at: { gte: new Date(now.getTime() - 30 * DAY) },
		},
		select: { action: true, at: true },
		orderBy: { at: 'asc' },
	});
	let lastLookup = -Infinity;
	const openings = [];
	for (const { action, at } of rows) {
		const t = new Date(at).getTime();
		if (action === 'passport.lookup') lastLookup = t;
		else if (t - lastLookup <= FOLLOW_UP) continue;
		openings.push(new Date(t));
	}
	const dias = [...new Set(openings.map(d => d.toISOString().slice(0, 10)))].reverse();
	return { veces: openings.length, dias };
};

const hasPassport = usuario => usuario.estado === 'aceptado' && Number.isInteger(usuario.numeroPasaporte) && usuario.numeroPasaporte >= 1000;

module.exports = { fieldGroups, linkOpenings, hasPassport };
