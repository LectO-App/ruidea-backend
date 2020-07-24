const mongoose = require('mongoose');
const { json } = require('body-parser');

const Diagnostico = mongoose.Schema({
    dislexia: {
        type: Boolean,
        required: true
    },
    discalculia: { type: Boolean, required: true }
})

const Usuario = mongoose.Schema({
    nombre: { type: String, required: true },
    apellidos: { type: String, required: true },
    lugarResidencia: { type: String, required: true },
    numeroDocumento: { type: String, required: true },
    fechaNacimiento: { type: Date, required: true },
    correoElectronico: { type: String, required: true },
    numeroTelefono: { type: String, required: true },
    diagnostico: Diagnostico,
    linkDiagnostico: { type: String, required: true },
    linkPasaporte: { type: String, required: true },
    estado: { type: String, required: true },
    mensajeMedico: { type: String, default: "" }
});

module.exports = mongoose.model('Usuario', Usuario);