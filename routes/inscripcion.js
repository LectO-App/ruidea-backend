const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Usuario = require('../models/modeloUsuario');
const { json } = require('body-parser');

router.get('/', async(req, res) => {
    try {
        const users = await Usuario.find();
        res.json(users);
    } catch (err) {
        res.json({ message: err })
    }
});

// pasar modeloUsuario
router.post('/', async(req, res) => {
    const user = req.body;

    try {
        user.password = await bcrypt.hash(user.password, 10);
        user.fechaNacimiento = new Date(user.fechaNacimiento);
        user.fechaCreacion = Date.now();
        const savedUser = await Usuario(user).save();
        res.json(savedUser);

    } catch (err) {
        console.log(err);
        res.status(401).json({ message: err });
    }

});

// pasar modeluUsario
router.put('/actualizar', async(req, res) => {
    try{
        const user = req.body;
        const update = await Usuario.findOneAndUpdate({ _id: user._id}, { $set: {
            nombre:  user.nombre,
            apellidos: user.apellidos,
            paisResidencia: user.paisResidencia,
            localidadResidencia: user.localidadResidencia,
            lugarNacimiento: user.lugarNacimiento,
            numeroDocumento: user.numeroDocumento,
            fechaNacimiento: user.fechaNacimiento,
            correoElectronico: user.correoElectronico,
            numeroTelefono: user.numeroTelefono,
            diagnostico: {
                dislexia: user["diagnostico"].dislexia,
                discalculia: user["diagnostico"].discalculia,
                disortografía: user["diagnostico"].disortografía,
                dispraxia: user["diagnostico"].dispraxia,
                tdah: user["diagnostico"].tdah
            },
            linkDiagnostico: user.linkDiagnostico,
            linkPasaporte: user.linkPasaporte,
            password: await bcrypt.hash(user.password, 10),
            fechaCreacion: Date.now(),
            estado: "pendiente"

        }});
        res.json({ update });
    }
    catch(err) {
        console.log(err);
        res.json({ message: err }).status(401);
    }
});

// pasar json del estilo:
// {
//     mail: correoElectronico
// }
router.post('/comprobar-mail', async(req, res) => {
    try{
        const user = await Usuario.exists({ correoElectronico: req.body.mail });
        console.log(user);
        if(user) res.json({ disponible: false });
        else res.json({ disponible: true });
    }
    catch(err){
        res.json({ message: err });
    }
});

// ignorar
router.post('/borrar', async(req,res) => {
    try{
        const users = await Usuario.deleteMany();
        res.json(users);
    }
    catch(err) {
        console.log(err);
        res.status(401).json({ message: err });
    }
})

module.exports = router;