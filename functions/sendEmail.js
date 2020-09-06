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

const sendEmailAdmin = async (email, estado) => {
  let transporter = await nodemailer.createTransport({
    host: "c1341585.ferozo.com",
    port: 465,
    secure: true,
    auth: {
      user: "contacto@lecto.app", // generated ethereal user
      pass: "Exdyslexiapp2020", // generated ethereal password
    },
  });

  switch (estado) {
    case "aceptado":
      await transporter.sendMail({
        from: '"RUIDEA" contacto@lecto.app', // sender address
        to: email,
        subject: "Tu solicitud de RUIDEA",
        html: `
            <h3>Buenos días!</h3> 
            <p>Te agradecemos por registrarte en RUIDEA!</p> 
            <p>Luego de que lo revisen, los especialistas determinaron que su solicitud era correcta, por lo que fue aceptada!</p>
            <p>¿Qué es lo siguiente? Entra a RUIDEA para descargar el pasaporte, ya sea en formato PDF o JPG</p> 
            <a href='http://localhost:3000/login'>Ir a RUIDEA</a>
            `,
      });
      break;
    case "revision":
      const user = await Usuario.find({ correoElectronico: email });
      await transporter.sendMail({
        from: '"RUIDEA" contacto@lecto.app', // sender address
        to: email,
        subject: "Tu solicitud de RUIDEA",
        html: `
        <h3>Buenos días!</h3> 
        <p>Te agradecemos por registrarte en RUIDEA!</p> 
        <p>Luego de que lo revisen, los especialistas determinaron que su solicitud estaba incompleta o incorrecta.</p>
        <p>Mensaje del especialista:</p>
        <p><i>{user.mensajeMedico}</i></p>
        <p>¿Qué es lo siguiente? Entra a RUIDEA para volver a enviar el formulario</p> 
        <a href='http://localhost:3000/dashboard'>Ir a RUIDEA</a>
            `,
      });
      break;
    case "rechazado":
      const userR = await Usuario.find({ correoElectronico: email });
      await transporter.sendMail({
        from: '"RUIDEA" contacto@lecto.app', // sender address
        to: email,
        subject: "Tu solicitud de RUIDEA",
        html: `
        <h3>Buenos días!</h3> 
        <p>Te agradecemos por registrarte en RUIDEA!</p> 
        <p>Lo sentimos, pero luego de que lo revisen, los especialistas determinaron que su solicitud era incorrecta y fue rechazada.</p>
        <p>Mensaje del especialista:</p>
        <p><i>${userR.mensajeMedico}</i></p>
        <a href='http://localhost:3000/dashboard'>Ir a RUIDEA</a>
            `,
      });
      break;
  }
};

module.exports = { sendEmail, sendEmailAdmin };
