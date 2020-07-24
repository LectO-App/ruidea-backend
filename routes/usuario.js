const express = require('express');
const router = express.Router();
const Usuario = require('../models/userModel');

// // pasar JSON del estilo:
// {
//     "id": "documentoDelUsuario"
// }

router.get('/estado', async(req, res) => {
    const request = req.body;
    const usuarioSolicitado = await Usuario.findOne({ _id: request.id });
    const respuesta = {
        "estado": usuarioSolicitado.estado,
        "mensajeMedico": usuarioSolicitado.mensajeMedico
    };

    res.json(respuesta);
});

module.exports = router;