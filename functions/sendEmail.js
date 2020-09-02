const nodemailer = require("nodemailer");
const Usuario = require("../models/modeloUsuario");
const jwt = require("jsonwebtoken");

const sendEmail = async (id) => {
  const user = await Usuario.findById(id);

  const emailToken = jwt.sign(
    {
      id,
    },
    process.env.SECURITY_KEY,
    { expiresIn: "12h" }
  );

  let transporter = await nodemailer.createTransport({
    host: "c1341585.ferozo.com",
    port: 465,
    secure: true,
    auth: {
      user: "contacto@lecto.app", // generated ethereal user
      pass: "Exdyslexiapp2020", // generated ethereal password
    },
  });
  let info = await transporter.sendMail({
    from: '"RUIDEA" contacto@lecto.app', // sender address
    to: user.correoElectronico,
    subject: "Confirmar correo electrónico de RUIDEA",
    text: "Hola",
    html: `
        <h3>Buenos días!</h3> 
        <p>Te agradecemos por registrarte en RUIDEA!</p> 
        <p>Necesitamos que entres al siguiente link para demostrar que este email es tuyo y no eres un robot.</p> 
        <a href='https://localhost:3000/verificarEmail/${emailToken}'>Verificar</a>
        `,
  });
};

module.exports = sendEmail;
