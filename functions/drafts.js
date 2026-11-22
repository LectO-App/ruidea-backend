const { getPrisma } = require('../db/prisma');

const REMINDER_ACTION = 'admin.draft_reminder';

const filled = value => typeof value === 'string' && value.trim() !== '';

const hasDiagnosis = d => !!d && Object.values(d).some(Boolean);

// The application form's steps after the account exists, in the front end's order
// (ruidea-frontend src/components/Form.js). Documents are saved only when the person
// sends the application, so on a draft that step is complete only if an upload stored a zip.
const STEPS = [
	{
		clave: 'datos',
		titulo: 'Tus datos',
		completo: u =>
			filled(u.nombre) &&
			filled(u.apellidos) &&
			u.fechaNacimiento != null &&
			(!u.esTutor || (filled(u.tutorNombre) && filled(u.tutorApellidos))),
	},
	{
		clave: 'residencia',
		titulo: 'Residencia y documento',
		completo: u => [u.paisResidencia, u.localidadResidencia, u.lugarNacimiento, u.numeroDocumento, u.numeroTelefono].every(filled),
	},
	{ clave: 'diagnostico', titulo: 'Diagnóstico', completo: u => hasDiagnosis(u.diagnostico) },
	{ clave: 'documentos', titulo: 'Documentos', completo: u => filled(u.archivoBlob) },
	{ clave: 'revision', titulo: 'Revisar y enviar', completo: u => u.estado !== 'borrador' },
];

const draftProgress = user => ({
	pasos: STEPS.map(({ clave, titulo, completo }) => ({ clave, titulo, completo: completo(user) })),
});

// When each of these records last got a draft reminder, read from the audit trail.
// Map of record id -> Date.
const lastReminders = async ids => {
	if (!ids.length) return new Map();
	const groups = await getPrisma().auditLog.groupBy({
		by: ['target'],
		where: { action: REMINDER_ACTION, target: { in: ids } },
		_max: { at: true },
	});
	return new Map(groups.map(g => [g.target, g._max.at]));
};

module.exports = { REMINDER_ACTION, draftProgress, lastReminders };
