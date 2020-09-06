const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const Usuario = require("../models/modeloUsuario");
const auth = require("../middlewares/request-auth");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const { sendEmail, sendEmailAdmin } = require("../functions/sendEmail");

router.post("/confirm/:token", async (req, res) => {
  try {
    const id = jwt.verify(req.params.token, process.env.SECURITY_KEY);

    const newUser = await Usuario.findById(id.id);

    newUser.emailVerificado = true;
    await newUser.save();

    res.send("Usuario verificado!");
  } catch (err) {
    if (err.kind === "ObjectId") {
      return res.status(400).send("No se encontró ningún usuario con ese ID.");
    }
    return res.status(400).json({ err });
  }
});

router.post("/resend/:id", async (req, res) => {
  try {
    await sendEmail(req.params.id);
    res.send("Email de verificación enviado nuevamente");
  } catch (err) {
    console.log(err);
  }
});

module.exports = router;
