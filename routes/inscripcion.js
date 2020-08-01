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

router.post('/', async(req, res) => {
    const user = req.body;

    try {
        user.password = await bcrypt.hash(user.password, 10);
        const newUser = Usuario(user);
        const savedUser = await newUser.save();
        res.json(savedUser);

    } catch (err) {
        res.json({ message: err });
    }

});

module.exports = router;