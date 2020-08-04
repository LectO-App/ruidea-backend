const express = require('express');
const router = express.Router();
const Usuario = require('../models/modeloUsuario');
const bcrypt = require('bcrypt');
const { route } = require('./inscripcion');

// pasar JSON del estilo
// {
//     user: user,
//     password: password
// }
router.post('/login', async(req,res) => {
    try{
        if(req.body.user == process.env.USER_ADMIN){
            if(await bcrypt.compare(req.body.password, process.env.CLAVE_HASHEADA_ADMIN)) res.json({ correcto: true });
            else res.status(401).json({ correcto: false });
        }
        else res.status(401).json({ correcto: false })
    }
    catch(err) {
        res.status(401).json({ message: err });
    }
});

// pasar JSON del estilo:
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
                var numeroPasaporteActual = await Usuario.find({ estado: "aceptado" }).countDocuments();
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

// pasar JSON del estilo
// {
//     condicion: "pendiente/aceptado/rechazado/revision o vacio si quiere todos"
// }
router.post('/solicitudes', async(req,res) => {
    try{
        if(req.body.condicion == "") var usuarios = await Usuario.find();
        else var usuarios = await Usuario.find({ estado: req.body.condicion });
        res.json(usuarios);
    }
    catch(err) {
        console.log(err);
        res.status(401).json({ message: err });
    }
});

router.post('/solicitudes/:id', async(req, res) => {
    try{
        const usuario = await Usuario.findOne({ _id: req.params.id });
        res.json({usuario});
    }
    catch(err) {
        res.status(401).json({ message: err });
    }
})

module.exports = router;