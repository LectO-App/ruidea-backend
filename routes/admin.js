const express = require('express');
const router = express.Router();
const Usuario = require('../models/userModel');
const { route } = require('./inscripcion');

// Pasar JSON del estilo:
// {
//     "idUsuario": "Int",
//     "estado": "aceptado/revision/rechazado/pendiente (este último si aún no lo revisó)",
//     "mensajeMedico": "vacío si aceptado, completo si pide revisión"
// }

router.post('/respuesta', async(req, res) => {
    const request = req.body;
    switch (request.estado) {
        case 'aceptado':
            var updatedUser = await Usuario.updateOne({ _id: request.idUsuario }, {
                $set: { estado: "aceptado" }
            });
            res.json(updatedUser);
            break;

        case 'revision':
            var updatedUser = await Usuario.updateOne({ _id: request.idUsuario }, {
                $set: { mensajeMedico: request.mensajeMedico, estado: "revision" }
            });
            res.json(updatedUser);
            break;

        case 'rechazado':
            var updatedUser = await Usuario.updateOne({ _id: request.idUsuario }, {
                $set: { estado: "rechazado" }
            });
            res.json(updatedUser);
            break;
    }
});

module.exports = router;