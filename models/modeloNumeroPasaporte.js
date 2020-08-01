const mongoose = require('mongoose');

const NumeroPasaporte = mongoose.Schema({
    numeroActual: { type: Number, default: 0 },
    identificador: { type: String, default: "id" }
})

module.exports = mongoose.model('numero_pasaporte', NumeroPasaporte)