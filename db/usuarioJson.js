// Mapping between a `usuarios` row and the JSON the API has always returned for a user
// (the old Mongoose document's toJSON()). Pure functions, shared by the app and by
// scripts/mongo-to-postgres.js, which checks every copied record against Mongoose's own
// output with them.
//
// Mongoose rules reproduced here:
// - fields without a schema default are left out when unset (`undefined`), so they are
//   omitted when the column is NULL (an explicit null from MongoDB is kept in `extra`);
// - fields with a default are always present, null included;
// - `diagnostico` is a nested object; `password` and `__v` are never serialized;
// - fields the schema doesn't declare (left by older versions) are still returned; they
//   live in `extra`.

// Schema order of the old Mongoose model.
const FIELDS = [
	['nombre', 'optional'],
	['apellidos', 'optional'],
	['paisResidencia', 'optional'],
	['localidadResidencia', 'optional'],
	['lugarNacimiento', 'optional'],
	['tipoDocumento', 'default'],
	['numeroDocumento', 'optional'],
	['fechaNacimiento', 'optional'],
	['correoElectronico', 'required'],
	['numeroTelefono', 'optional'],
	['diagnostico', 'nested'],
	['esTutor', 'default'],
	['tutorNombre', 'default'],
	['tutorApellidos', 'default'],
	['tutorParentesco', 'default'],
	['emailVerificado', 'default'],
	['fechaCreacion', 'optional'],
	['estado', 'default'],
	['mensajeMedico', 'default'],
	['numeroPasaporte', 'default'],
	['aceptoRecibirInfo', 'default'],
	['aceptoSolicitud', 'default'],
	['fechaConsentimiento', 'default'],
	['fechaEnvio', 'default'],
	['archivoBlob', 'default'],
];

// diagnostico key in the API -> column. `disortografía` keeps its accent in the API.
const DIAGNOSTICO = [
	['dislexia', 'dislexia'],
	['discalculia', 'discalculia'],
	['disortografía', 'disortografia'],
	['dispraxia', 'dispraxia'],
	['tdah', 'tdah'],
];

const KIND = new Map(FIELDS);
const DATE_FIELDS = new Set(['fechaNacimiento', 'fechaCreacion', 'fechaConsentimiento', 'fechaEnvio']);
// Keys of the API object that map to columns (plus _id and password).
const KNOWN_KEYS = new Set(['_id', 'password', '__v', ...KIND.keys()]);

const diagnosticoOf = row => {
	const out = {};
	for (const [key, col] of DIAGNOSTICO) out[key] = row[col];
	return out;
};

// Row -> the object Mongoose's toJSON() returned (Dates stay Date objects; res.json turns
// them into ISO strings). Never includes the password.
const rowToJson = row => {
	const out = { _id: row.id };
	for (const [field, kind] of FIELDS) {
		if (kind === 'nested') out[field] = diagnosticoOf(row);
		else if (kind === 'optional') {
			if (row[field] != null) out[field] = row[field];
		} else out[field] = row[field];
	}
	const extra = row.extra && typeof row.extra === 'object' ? row.extra : {};
	return { ...extra, ...out };
};

// Mongoose's toJSON() output of a MongoDB document (+ its password hash) -> row. Used by the
// copy script; the inverse of rowToJson.
const jsonToRow = (json, password) => {
	const row = { id: String(json._id), password };
	const extra = {};
	for (const [field, kind] of FIELDS) {
		const value = json[field];
		if (kind === 'nested') {
			const d = value || {};
			for (const [key, col] of DIAGNOSTICO) row[col] = d[key] === undefined ? null : d[key];
		} else {
			row[field] = value === undefined ? null : value;
			if (kind === 'optional' && value === null) extra[field] = null;
		}
	}
	for (const key of Object.keys(json)) {
		if (!KNOWN_KEYS.has(key)) extra[key] = json[key];
	}
	row.extra = Object.keys(extra).length ? JSON.parse(JSON.stringify(extra)) : null;
	return row;
};

// API-shaped values (as the routes wrote them with $set / create) -> Prisma `data`.
// - undefined values are skipped (Mongoose drops undefined keys from updates);
// - correoElectronico is trimmed and lowercased (the Mongoose setters);
// - `diagnostico` replaces the whole group, missing keys becoming false (a nested $set
//   replaced the subdocument and Mongoose filled missing keys with their default);
// - keys the schema doesn't declare are dropped (Mongoose strict mode).
const toData = values => {
	const data = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) continue;
		if (key === 'diagnostico') {
			const d = value || {};
			for (const [k, col] of DIAGNOSTICO) data[col] = d[k] === undefined ? false : d[k];
		} else if (key === 'correoElectronico') {
			data[key] = typeof value === 'string' ? value.trim().toLowerCase() : value;
		} else if (DATE_FIELDS.has(key)) {
			data[key] = value == null ? null : new Date(value);
		} else if (key === 'password' || KIND.has(key)) {
			data[key] = value;
		}
	}
	return data;
};

module.exports = { FIELDS, DIAGNOSTICO, DATE_FIELDS, KNOWN_KEYS, rowToJson, jsonToRow, toData };
