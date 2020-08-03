const express = require('express');
const router = express.Router();
const Usuario = require('../models/modeloUsuario');
const { route } = require('./inscripcion');

// Pasar JSON del estilo:
// {
//     "emailUsuario": "String", (puede ser ID sino, como quieras)
//     "estado": "aceptado/revision/rechazado/pendiente (este último si aún no lo revisó)",
//     "mensajeMedico": vacío si aceptado, completo si pide revisión
// }

router.post('/respuesta', async(req, res) => {
    try {
        const request = req.body;
        switch (request.estado) {
            case 'aceptado':
                var numeroPasaporteActual = await Usuario.find({ estado: "aceptado" }).count();
                const user = await Usuario.findOne({ correoElectronico: req.body.emailUsuario });
                if(user.estado == "aceptado") numeroPasaporteActual = user.numeroPasaporte - 1;
                var updatedUser = await Usuario.updateOne({ correoElectronico: request.emailUsuario }, {
                    $set: { estado: "aceptado", numeroPasaporte: numeroPasaporteActual + 1 }
                });
                res.json(updatedUser);
                break;

            case 'revision':
                var updatedUser = await Usuario.updateOne({ correoElectronico: request.emailUsuario }, {
                    $set: { mensajeMedico: request.mensajeMedico, estado: "revision" }
                });
                res.json(updatedUser);
                break;

            case 'rechazado':
                var updatedUser = await Usuario.updateOne({ correoElectronico: request.emailUsuario }, {
                    $set: { mensajeMedico: request.mensajeMedico, estado: "rechazado" }
                });
                res.json(updatedUser);
                break;
        }
    } catch (err) {
        console.log(err);
        res.json({ message: err });
    }
});

module.exports = router;