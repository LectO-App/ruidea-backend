const mongoose = require('mongoose');
const { json } = require('body-parser');

const Usuario = mongoose.Schema({
    nombre: { type: String, required: true },
    apellidos: { type: String, required: true },
    lugarResidencia: { type: String, required: true },
    lugarNacimiento: { type: String, required: true },
    numeroDocumento: { type: String, required: true },
    fechaNacimiento: { type: Date, required: true },
    correoElectronico: { type: String, required: true, trim: true, index: true, unique: true },
    numeroTelefono: { type: String, required: true },
    diagnostico: {
        dislexia: { type: Boolean, required: true },
        discalculia: { type: Boolean, required: true },
        disortografía: { type: Boolean, required: true },
        dispraxia: { type: Boolean, required: true },
        "tda-h": { type: Boolean, required: true }
    },
    linkDiagnostico: { type: String, required: true },
    linkPasaporte: { type: String, required: true },
    password: { type: String, required: true },
    estado: { type: String, default: "pendiente" },
    mensajeMedico: { type: String, default: "" },
    numeroPasaporte: { type: Number, required: false, index: true, unique: true }
});

module.exports = mongoose.model('usuario', Usuario);