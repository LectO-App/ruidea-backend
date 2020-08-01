const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Usuario = require('../models/modeloUsuario');

// pasar JSON del estilo:
// {
//     "id": "documentoDelUsuario"
// }
// podría ser también un parámetro de la búsqueda, preguntar qué prefieren

router.get('/estado', async(req, res) => {
    const usuarioSolicitado = await Usuario.findOne({ _id: req.body.id });
    const respuesta = {
        "estado": usuarioSolicitado.estado,
        "mensajeMedico": usuarioSolicitado.mensajeMedico
    };

    res.json(respuesta);
});

// pasar JSON del estilo:
// {
//     "user": mail o numero de pasaporte
//     "password": contraseña 
// }

router.get('/count', async(req, res) => {
    try {
        const cant = await Usuario.countDocuments();
        res.json({ cant: cant });
    } catch (err) {
        res.json({ message: err });
    }
});

router.get('/login', async(req, res) => {

    try {
        const usuario = await Usuario.findOne({ correoElectronico: req.body.user });
        if (await bcrypt.compare(req.body.password, usuario.password)) {
            res.json({ correcto: true, usuario: usuario });
        } else {
            res.json({ correcto: false });
        }
    } catch (err) {
        res.json({ message: err });
    }

});

module.exports = router;