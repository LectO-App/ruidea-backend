// The fields anyone with the holder's link (share token, QR code or legacy number link) sees
// on the public passport page. Never the whole record (§1.6, §2.2). "Mis datos" labels these
// fields "en tu enlace" (functions/misDatos.js), so the two lists cannot drift apart.
const PUBLIC_FIELDS = [
	'nombre',
	'apellidos',
	'paisResidencia',
	'numeroDocumento',
	'numeroPasaporte',
	'fechaNacimiento',
	'diagnostico',
	'estado',
];

const publicView = u => Object.fromEntries(PUBLIC_FIELDS.map(field => [field, u[field]]));

module.exports = { PUBLIC_FIELDS, publicView };
