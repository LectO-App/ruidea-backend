const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const generateImage = require('../functions/imagen.js');
const Usuario = require('../models/modeloUsuario');

router.post('/verificar/:numeroDocumento/:numeroPasaporte', async(req, res) => {
    const usuarioSolicitado = await Usuario.findOne({ numeroPasaporte: req.params.numeroPasaporte });
    if(usuarioSolicitado == null || usuarioSolicitado.numeroDocumento != req.params.numeroDocumento) return res.json({ existe: false });
    res.json({ existe: true, usuario: usuarioSolicitado });
});

router.get('/estado/:id', async(req, res) => {
    const usuarioSolicitado = await Usuario.findOne({ _id: req.params.id });
    const respuesta = {
        "estado": usuarioSolicitado.estado,
        "mensajeMedico": usuarioSolicitado.mensajeMedico,
        "nombre": usuarioSolicitado.nombre,
        "numeroPasaporte": usuarioSolicitado.numeroPasaporte,
        "numeroDocumento": usuarioSolicitado.numeroDocumento
    };

    res.json(respuesta);
});

// pasar JSON del estilo:
// {
//     "user": mail o numero de pasaporte
//     "password": contraseña 
// }
router.post('/login', async(req, res) => {
    try {
        // Busco el usuario
        if(!isNaN(req.body.user)) var usuario = await Usuario.findOne({ numeroPasaporte: req.body.user });
        else var usuario = await Usuario.findOne({ correoElectronico: req.body.user });
        if(usuario == null) return res.status(401).json({ correcto: false });

        // Verifico la contraseña
        if (await bcrypt.compare(req.body.password, usuario.password)) {
            res.json({ correcto: true, usuario: usuario });
        } else {
            res.status(401).json({ correcto: false });
        }
    } catch (err) {
        res.status(401).json({ message: err });
    }
});

// Ignorar
router.get('/count', async(req, res) => {
    try {
        const cant = await Usuario.countDocuments();
        res.json({ cant: cant });
    } catch (err) {
        res.json({ message: err });
    }
});

// pasar JSON del estilo
// {
//     _id: 'id del usuario'
// }
router.post('/imagen-pasaporte', async(req, res) => {
    try{
        const user = await Usuario.findById(req.body._id);
        const documento = user.numeroDocumento;
        const pasaporte = user.numeroPasaporte;

        const im = await generateImage(
            `https://ruidea.netlify.app/verificar/${documento}/${pasaporte}`,
            user.nombre + " " + user.apellidos,
            user.pais,
            pasaporte
          );
          const img = Buffer.from(im, "base64").toJSON();
          res.send(img)

        // res.writeHead(200, {
        //     'Content-Type': 'image/png',
        //     'Content-Disposition': 'attachment; filename=pasaporte.png',
        //     'Content-Length': img.length
        //   });
        //   res.end(img);
        // res.set({'Content-Type': 'image/png'});
        // res.send(img);
        // res.writeHead(200, { 'Content-Type': 'image/png' });
        // res.end(img, 'binary');
    }
    catch(err){
        res.status(401).json({ message: err });
    }
});

module.exports = router;
