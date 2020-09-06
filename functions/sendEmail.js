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
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "pasaporte@dea.ong", // generated ethereal user
      pass: process.env.SMTP_KEY, // generated ethereal password
    },
  });
  let info = await transporter.sendMail({
    from: '"RUIDEA" pasaporte@dea.ong', // sender address
    to: user.correoElectronico,
    subject: "Confirmar correo electrónico de RUIDEA",
    text: "Hola",
    html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional //EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml"> <head><!--[if gte mso 9]><xml ><o:OfficeDocumentSettings ><o:AllowPNG/><o:PixelsPerInch >96</o:PixelsPerInch ></o:OfficeDocumentSettings ></xml ><! [endif]--> <meta content="text/html; charset=utf-8" http-equiv="Content-Type"/> <meta content="width=device-width" name="viewport"/> <meta content="IE=edge" http-equiv="X-UA-Compatible"/> <title></title> <link rel="stylesheet" href="https://use.typekit.net/nkh3uvc.css"/> <style type="text/css"> body{margin: 0; padding: 0;}table, td, tr{vertical-align: top; border-collapse: collapse;}*{line-height: inherit;}a[x-apple-data-detectors="true"]{color: inherit !important; text-decoration: none !important;}</style> <style id="media-query" type="text/css"> @media (max-width: 570px){.block-grid, .col{min-width: 320px !important; max-width: 100% !important; display: block !important;}.block-grid{width: 100% !important;}.col{width: 100% !important;}.col > div{margin: 0 auto;}img.fullwidth, img.fullwidthOnMobile{max-width: 100% !important;}.no-stack .col{min-width: 0 !important; display: table-cell !important;}.no-stack.two-up .col{width: 50% !important;}.no-stack .col.num4{width: 33% !important;}.no-stack .col.num8{width: 66% !important;}.no-stack .col.num4{width: 33% !important;}.no-stack .col.num3{width: 25% !important;}.no-stack .col.num6{width: 50% !important;}.no-stack .col.num9{width: 75% !important;}.video-block{max-width: none !important;}.mobile_hide{min-height: 0px; max-height: 0px; max-width: 0px; display: none; overflow: hidden; font-size: 0px;}.desktop_hide{display: block !important; max-height: none !important;}}</style> </head> <body class="clean-body" style=" margin: 0; padding: 0; -webkit-text-size-adjust: 100%; background-color: #f2f2f2; " > <table bgcolor="#f2f2f2" cellpadding="0" cellspacing="0" class="nl-container" role="presentation" style=" table-layout: fixed; vertical-align: top; min-width: 320px; margin: 0 auto; border-spacing: 0; border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; background-color: #f2f2f2; width: 100%; " valign="top" width="100%" > <tbody> <tr style="vertical-align: top" valign="top"> <td style="word-break: break-word; vertical-align: top" valign="top"> <div style="background-color: transparent"> <div class="block-grid" style=" margin: 0 auto; min-width: 320px; max-width: 550px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; background-color: #ffffff; " > <div style=" border-collapse: collapse; display: table; width: 100%; background-color: #ffffff; " > <div class="col num12" style=" min-width: 320px; max-width: 550px; display: table-cell; vertical-align: top; width: 550px; " > <div style="width: 100% !important"> <div style=" border-top: 0px solid transparent; border-left: 0px solid transparent; border-bottom: 0px solid transparent; border-right: 0px solid transparent; padding-top: 15px; padding-bottom: 5px; padding-right: 10px; padding-left: 10px; " > <div style=" color: #101010; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; line-height: 1.2; padding-top: 10px; padding-right: 10px; padding-bottom: 10px; padding-left: 10px; " > <div style=" line-height: 1.2; font-size: 12px; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; color: #101010; mso-line-height-alt: 14px; " > <p style=" font-size: 14px; line-height: 1.2; text-align: center; font-family: Muli, Tahoma, Verdana, Segoe, sans-serif; word-break: break-word; mso-line-height-alt: 17px; margin: 0; " > <strong ><span style="font-size: 38px" >Gracias por registrarte en RUIDEA!</span ></strong > </p></div></div></div></div></div></div></div></div><div style="background-color: transparent"> <div class="block-grid" style=" margin: 0 auto; min-width: 320px; max-width: 550px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; background-color: #ffffff; " > <div style=" border-collapse: collapse; display: table; width: 100%; background-color: #ffffff; " > <div class="col num12" style=" min-width: 320px; max-width: 550px; display: table-cell; vertical-align: top; width: 550px; " > <div style="width: 100% !important"> <div style=" border-top: 0px solid transparent; border-left: 0px solid transparent; border-bottom: 0px solid transparent; border-right: 0px solid transparent; padding-top: 0px; padding-bottom: 30px; padding-right: 0px; padding-left: 0px; " > <div style=" color: #555555; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; line-height: 1.5; padding-top: 15px; padding-right: 35px; padding-bottom: 15px; padding-left: 35px; " > <div style=" line-height: 1.5; font-size: 12px; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; color: #555555; mso-line-height-alt: 18px; " > <p style=" font-size: 17px; line-height: 1.5; text-align: center; font-family: Muli, Tahoma, Verdana, Segoe, sans-serif; word-break: break-word; mso-line-height-alt: 26px; mso-ansi-font-size: 18px; margin: 0; " > <span style=" font-size: 17px; color: #808080; mso-ansi-font-size: 18px; " >Necesitamos que entre al siguiente link para demostrar que este email es suyo y no es un robot.</span > </p></div></div><div style=" color: #555555; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; line-height: 1.5; padding-top: 10px; padding-right: 35px; padding-bottom: 10px; padding-left: 35px; " > <div style=" line-height: 1.5; font-size: 12px; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; color: #555555; mso-line-height-alt: 18px; " > <p style=" font-size: 17px; line-height: 1.5; text-align: center; font-family: Muli, Tahoma, Verdana, Segoe, sans-serif; word-break: break-word; mso-line-height-alt: 26px; mso-ansi-font-size: 18px; margin: 0; " > <span style=" font-size: 17px; color: #808080; mso-ansi-font-size: 18px; " >Una vez que verifique su cuenta, nuestros especialistas revisarán su solicitud y le contactaremos para informarle el estado de su solicitud. </span > </p></div></div><div align="center" class="button-container" style=" padding-top: 15px; padding-right: 10px; padding-bottom: 10px; padding-left: 10px; " ><!--[if mso]><table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-spacing: 0; border-collapse: collapse; mso-table-lspace:0pt; mso-table-rspace:0pt;"><tr><td style="padding-top: 15px; padding-right: 10px; padding-bottom: 10px; padding-left: 10px" align="center"><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://pasaporte.dea.ong" style="height:39pt; width:278.25pt; v-text-anchor:middle;" arcsize="12%" stroke="false" fillcolor="#41a1ac"><w:anchorlock/><v:textbox inset="0,0,0,0"><center style="color:#ffffff; font-family:Tahoma, Verdana, sans-serif; font-size:16px"><! [endif]--><a href="https://pasaporte.dea.ong/verificarEmail/${emailToken}" style=" -webkit-text-size-adjust: none; text-decoration: none; display: inline-block; color: #ffffff; background-color: #41a1ac; border-radius: 6px; -webkit-border-radius: 6px; -moz-border-radius: 6px; width: auto; width: auto; border-top: 1px solid #41a1ac; border-right: 1px solid #41a1ac; border-bottom: 1px solid #41a1ac; border-left: 1px solid #41a1ac; padding-top: 10px; padding-bottom: 10px; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; text-align: center; mso-border-alt: none; word-break: keep-all; " target="_blank" ><span style=" padding-left: 30px; padding-right: 30px; font-size: 16px; display: inline-block; " ><span style=" font-size: 16px; line-height: 2; font-family: Muli, Tahoma, Verdana, Segoe, sans-serif; word-break: break-word; mso-line-height-alt: 32px; " ><strong >VERIFICAR CORREO ELECTRÓNICO</strong ></span ></span ></a > </div></div></div></div></div></div></div><div style="background-color: transparent"> <div class="block-grid" style=" margin: 0 auto; min-width: 320px; max-width: 550px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; background-color: #ffffff; " > <div style=" border-collapse: collapse; display: table; width: 100%; background-color: #ffffff; " > <div class="col num12" style=" min-width: 320px; max-width: 550px; display: table-cell; vertical-align: top; width: 550px; " > <div style="width: 100% !important"> <div style=" border-top: 0px solid transparent; border-left: 0px solid transparent; border-bottom: 0px solid transparent; border-right: 0px solid transparent; padding-top: 5px; padding-bottom: 5px; padding-right: 0px; padding-left: 0px; " > <div style=" color: #555555; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; line-height: 1.2; padding-top: 10px; padding-right: 10px; padding-bottom: 10px; padding-left: 10px; " > <div style=" line-height: 1.2; font-size: 12px; font-family: 'Muli', Tahoma, Verdana, Segoe, sans-serif; color: #555555; mso-line-height-alt: 14px; " > <p style=" font-size: 14px; line-height: 1.2; text-align: center; font-family: Muli, Tahoma, Verdana, Segoe, sans-serif; word-break: break-word; mso-line-height-alt: 17px; margin: 0; " > <em ><span style=" font-size: 13px; mso-ansi-font-size: 14px; " >Sistema desarrollado por el equipo de LectO, en colaboración con Disfam.</span ></em > </p></div></div></div></div></div></div></div></div></td></tr></tbody> </table> </body></html>`,
  });
};

const sendEmailAdmin = async (email, estado) => {
  let transporter = await nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "pasaporte@dea.ong", // generated ethereal user
      pass: process.env.SMTP_KEY, // generated ethereal password
    },
  });

  switch (estado) {
    case "aceptado":
      await transporter.sendMail({
        from: '"RUIDEA" pasaporte@dea.ong', // sender address
        to: email,
        subject: "Tu solicitud de RUIDEA",
        html: `
            <h3>Buenos días!</h3> 
            <p>Te agradecemos por registrarte en RUIDEA!</p> 
            <p>Luego de que lo revisen, los especialistas determinaron que su solicitud era correcta, por lo que fue aceptada!</p>
            <p>¿Qué es lo siguiente? Entra a RUIDEA para descargar el pasaporte, ya sea en formato PDF o JPG</p> 
            <a href='http://pasaporte.dea.ong/login'>Ir a RUIDEA</a>
            `,
      });
      break;
    case "revision":
      const user = await Usuario.find({ correoElectronico: email });
      await transporter.sendMail({
        from: '"RUIDEA" pasaporte@dea.ong', // sender address
        to: email,
        subject: "Tu solicitud de RUIDEA",
        html: `
        <h3>Buenos días!</h3> 
        <p>Te agradecemos por registrarte en RUIDEA!</p> 
        <p>Luego de que lo revisen, los especialistas determinaron que su solicitud estaba incompleta o incorrecta.</p>
        <p>Mensaje del especialista:</p>
        <p><i>{user.mensajeMedico}</i></p>
        <p>¿Qué es lo siguiente? Entra a RUIDEA para volver a enviar el formulario</p> 
        <a href='http://pasaporte.dea.ong/dashboard'>Ir a RUIDEA</a>
            `,
      });
      break;
    case "rechazado":
      const userR = await Usuario.find({ correoElectronico: email });
      await transporter.sendMail({
        from: '"RUIDEA" pasaporte@dea.ong', // sender address
        to: email,
        subject: "Tu solicitud de RUIDEA",
        html: `
        <h3>Buenos días!</h3> 
        <p>Te agradecemos por registrarte en RUIDEA!</p> 
        <p>Lo sentimos, pero luego de que lo revisen, los especialistas determinaron que su solicitud era incorrecta y fue rechazada.</p>
        <p>Mensaje del especialista:</p>
        <p><i>${userR.mensajeMedico}</i></p>
        <a href='http://pasaporte.dea.ong/dashboard'>Ir a RUIDEA</a>
            `,
      });
      break;
  }
};

module.exports = { sendEmail, sendEmailAdmin };
