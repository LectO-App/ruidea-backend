const mongoose = require("mongoose");

// Field-level `required` is intentionally NOT enforced on the application fields: a
// `borrador` (draft) record is created from just email + password and filled in
// progressively (REGISTRATION_UX.md §1). Completeness is validated by Zod (submitSchema)
// at the moment of submission, not by Mongoose on every partial autosave. Email is the
// one hard invariant (account identity), so it keeps required + unique.
const Usuario = mongoose.Schema({
    nombre: { type: String },
    apellidos: { type: String },
    paisResidencia: { type: String },
    localidadResidencia: { type: String },
    lugarNacimiento: { type: String },
    // dni | nie | pasaporte — drives the checksum validation in validation/identity.js.
    tipoDocumento: { type: String, enum: ["dni", "nie", "pasaporte", null], default: null },
    numeroDocumento: { type: String },
    fechaNacimiento: { type: Date },
    correoElectronico: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true,
        unique: true,
    },
    numeroTelefono: { type: String }, // stored E.164 (e.g. +34600123123)
    diagnostico: {
        dislexia: { type: Boolean, default: false },
        discalculia: { type: Boolean, default: false },
        disortografía: { type: Boolean, default: false },
        dispraxia: { type: Boolean, default: false },
        tdah: { type: Boolean, default: false },
    },
    // Guardian / minor branch (§0): a parent/guardian applying on behalf of a child.
    esTutor: { type: Boolean, default: false },
    tutorNombre: { type: String, default: "" },
    tutorApellidos: { type: String, default: "" },
    tutorParentesco: { type: String, default: "" },
    password: { type: String, required: true },
    // hasta acá
    emailVerificado: { type: Boolean, default: false },
    fechaCreacion: { type: Date, required: true },
    // borrador = incomplete draft (excluded from review queues); pendiente = submitted.
    estado: { type: String, default: "borrador" },
    mensajeMedico: { type: String, default: "" },
    numeroPasaporte: { type: Number, default: -1 },
    aceptoRecibirInfo: { type: Boolean, default: false },
    // Persist the privacy-policy consent that the form already collects (§5.5/§8.2).
    aceptoSolicitud: { type: Boolean, default: false },
    fechaConsentimiento: { type: Date, default: null },
    // When the applicant submitted the completed application for review (§7).
    fechaEnvio: { type: Date, default: null },
    // Server-side pointer to the uploaded-documents blob (replaces email-substring
    // enumeration in link-archivos, §6.1). Set on upload.
    archivoBlob: { type: String, default: "" },
});

// Enforce passport-number uniqueness for issued passports only (>= 1000), so the many
// default -1 records don't collide (§5.1).
Usuario.index(
    { numeroPasaporte: 1 },
    { unique: true, partialFilterExpression: { numeroPasaporte: { $gte: 1000 } } }
);

// Never serialize the password hash (or internal fields) to any client. This strips
// it from every res.json(usuarioDoc) in one place (SECURITY_ASSESSMENT.md §2.2).
// The hash is still readable in code (e.g. for bcrypt.compare); only JSON output is filtered.
const stripSensitive = (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
};
Usuario.set("toJSON", { transform: stripSensitive });
Usuario.set("toObject", { transform: stripSensitive });

module.exports = mongoose.model("usuario", Usuario);
