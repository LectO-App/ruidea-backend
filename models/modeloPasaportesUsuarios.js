const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

const PasaporteUsuario = mongoose.Schema({
    _id: { type: mongoose.Types.ObjectId, required: true, index: true, unique: false },
    numeroPasaporte: { type: Number, required: true, index: true, unique: false }
});

module.exports = mongoose.model('PasaporteUsuario', PasaporteUsuario);