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

// pasar modeloUsuario
router.post('/', async(req, res) => {
    const user = req.body;

    try {
        user.password = await bcrypt.hash(user.password, 10);
        user.fechaNacimiento = new Date(user.fechaNacimiento);
        const savedUser = await Usuario(user).save();
        res.json(savedUser);

    } catch (err) {
        console.log(err);
        res.status(401).json({ message: err });
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