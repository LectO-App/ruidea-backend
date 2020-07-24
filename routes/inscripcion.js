const express = require('express');
const router = express.Router();
const Usuario = require('../models/userModel');
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
    user.estado = "pendiente";
    const newUser = Usuario(user);
    try {
        const savedUser = await newUser.save();
        res.json(savedUser);
    } catch (err) {
        res.json({ message: err });
    }
});

module.exports = router;