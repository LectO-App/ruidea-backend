const { z } = require('zod');
const identity = require('./identity');

const str = z.string().trim();
const email = str.toLowerCase().email().max(254);

// Phone: accept whatever the user typed (§2 dyscalculia: forgiving formats) and store
// one canonical E.164 shape. Fails with a kind, specific message if unparseable.
const telefono = str
	.min(1)
	.max(40)
	.transform((value, ctx) => {
		const e164 = identity.normalizePhone(value);
		if (!e164) {
			ctx.addIssue({ code: 'custom', message: 'El número de teléfono no es válido' });
			return z.NEVER;
		}
		return e164;
	});

const tipoDocumento = z.enum(['dni', 'nie', 'pasaporte']);

// Diagnosis group — the five recognised learning-disability conditions.
const diagnostico = z.object({
	dislexia: z.boolean(),
	discalculia: z.boolean(),
	disortografía: z.boolean(),
	dispraxia: z.boolean(),
	tdah: z.boolean(),
});

// Every boolean optional — used by the autosave (draft) path where a half-filled group
// is legitimate state, not an error.
const diagnosticoPartial = z.object({
	dislexia: z.boolean().optional(),
	discalculia: z.boolean().optional(),
	disortografía: z.boolean().optional(),
	dispraxia: z.boolean().optional(),
	tdah: z.boolean().optional(),
});

// At least one condition must be checked. Stops an all-false diagnosis silently reaching
// the medical reviewer as a blank application.
const hasDiagnosisChoice = d =>
	!!d && (d.dislexia || d.discalculia || d.disortografía || d.dispraxia || d.tdah);

// Guardian / minor branch (§0): when the applicant is a minor, a parent/guardian fills
// the form, so we capture who they are and their relationship.
const guardianFields = {
	esTutor: z.boolean().optional().default(false),
	tutorNombre: str.max(120).optional(),
	tutorApellidos: str.max(120).optional(),
	tutorParentesco: str.max(60).optional(),
};

// Strict applicant fields shared by one-shot register, full profile update, and submit.
const usuarioBase = {
	nombre: str.min(1).max(120),
	apellidos: str.min(1).max(120),
	paisResidencia: str.min(1).max(120),
	localidadResidencia: str.min(1).max(120),
	lugarNacimiento: str.min(1).max(120),
	tipoDocumento: tipoDocumento.optional(),
	numeroDocumento: str.min(1).max(60),
	fechaNacimiento: z.coerce.date(),
	correoElectronico: email,
	numeroTelefono: telefono,
	diagnostico,
	...guardianFields,
	aceptoRecibirInfo: z.boolean().optional().default(false),
	aceptoSolicitud: z.boolean().optional(),
};

// Cross-field rules applied on the strict paths: DNI/NIE checksum (when a type is
// declared), diagnosis choice present, and guardian details when esTutor is set.
const withCrossFieldChecks = schema =>
	schema.superRefine((data, ctx) => {
		// Spanish documents are checksum-validated; other countries' docs are accepted as-is
		// (an Argentine DNI has no check letter), so pass paisResidencia for the dispatch.
		if (data.tipoDocumento && !identity.isValidDocumento(data.tipoDocumento, data.numeroDocumento, data.paisResidencia)) {
			ctx.addIssue({ code: 'custom', path: ['numeroDocumento'], message: 'El número de documento no es válido' });
		}
		if (!hasDiagnosisChoice(data.diagnostico)) {
			ctx.addIssue({
				code: 'custom',
				path: ['diagnostico'],
				message: 'Indica al menos un diagnóstico',
			});
		}
		if (data.esTutor) {
			if (!data.tutorNombre) ctx.addIssue({ code: 'custom', path: ['tutorNombre'], message: 'Falta el nombre del tutor' });
			if (!data.tutorApellidos) ctx.addIssue({ code: 'custom', path: ['tutorApellidos'], message: 'Faltan los apellidos del tutor' });
		}
	});

// --- Account creation: the 15-second first step (§1). Email + password only. ---
const draftStartSchema = z.object({ correoElectronico: email, password: str.min(8).max(200) }).strip();

// --- Autosave: every field optional so a partial step persists without complaint. ---
const draftPatchSchema = z
	.object({
		nombre: str.max(120).optional(),
		apellidos: str.max(120).optional(),
		paisResidencia: str.max(120).optional(),
		localidadResidencia: str.max(120).optional(),
		lugarNacimiento: str.max(120).optional(),
		tipoDocumento: tipoDocumento.optional(),
		numeroDocumento: str.max(60).optional(),
		fechaNacimiento: z.coerce.date().optional(),
		numeroTelefono: telefono.optional(),
		diagnostico: diagnosticoPartial.optional(),
		...guardianFields,
		aceptoRecibirInfo: z.boolean().optional(),
		aceptoSolicitud: z.boolean().optional(),
	})
	.strip();

// --- Final submit: full strict validation before the application enters review. ---
const submitSchema = withCrossFieldChecks(
	z
		.object({ ...usuarioBase, aceptoSolicitud: z.literal(true, { message: 'Debes aceptar para continuar' }) })
		.strip()
);

// One-shot registration (legacy single POST) — same strict rules plus a password.
const registerSchema = withCrossFieldChecks(z.object({ ...usuarioBase, password: str.min(8).max(200) }).strip());

const updateSchema = withCrossFieldChecks(
	z.object({ _id: str.min(1), ...usuarioBase, password: str.min(8).max(200).optional() }).strip()
);

const loginSchema = z.object({ user: str.min(1).max(254), password: str.min(1).max(200) }).strip();

const adminLoginSchema = z.object({ user: str.min(1).max(120), password: str.min(1).max(200) }).strip();

const verifyCheckSchema = z
	.object({ pasaporte: z.coerce.number().int().positive(), password: str.max(200).optional() })
	.strip();

const forgotPasswordSchema = z.object({ email }).strip();

const changePasswordSchema = z.object({ token: str.min(1), password: str.min(8).max(200) }).strip();

const emailSchema = z.object({ mail: email }).strip();

const respuestaSchema = z
	.object({
		emailUsuario: email,
		estado: z.enum(['aceptado', 'revision', 'rechazado', 'pendiente']),
		mensajeMedico: str.max(5000).optional().default(''),
	})
	.strip();

const solicitudesSchema = z
	.object({ condicion: z.enum(['', 'pendiente', 'aceptado', 'rechazado', 'revision', 'borrador']).optional().default('') })
	.strip();

// The admin "modify" form posts flat diagnostic booleans (not the nested object) and a
// passport number, so this schema is defined explicitly rather than reusing usuarioBase.
const modificarSchema = z
	.object({
		id: str.min(1),
		nombre: str.min(1).max(120),
		apellidos: str.min(1).max(120),
		paisResidencia: str.min(1).max(120),
		localidadResidencia: str.min(1).max(120),
		lugarNacimiento: str.min(1).max(120),
		numeroDocumento: str.min(1).max(60),
		fechaNacimiento: z.coerce.date(),
		correoElectronico: email,
		numeroTelefono: str.min(1).max(40),
		dislexia: z.any().optional(),
		discalculia: z.any().optional(),
		disortografía: z.any().optional(),
		dispraxia: z.any().optional(),
		tdah: z.any().optional(),
		numeroPasaporte: z.coerce.number().int().nullable().optional(),
		estado: z.any().optional(),
		aceptoRecibirInfo: z.any().optional(),
		aceptoSolicitud: z.any().optional(),
	})
	.strip();

module.exports = {
	draftStartSchema,
	draftPatchSchema,
	submitSchema,
	registerSchema,
	updateSchema,
	loginSchema,
	adminLoginSchema,
	verifyCheckSchema,
	forgotPasswordSchema,
	changePasswordSchema,
	emailSchema,
	respuestaSchema,
	solicitudesSchema,
	modificarSchema,
};
