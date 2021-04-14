const express = require("express");
const router = express.Router();
const Usuario = require("../models/modeloUsuario");
const bcrypt = require("bcrypt");
const { sendEmailAdmin } = require("../functions/sendEmail");
const auth = require("../middlewares/request-auth");
const xl = require("excel4node");

// pasar JSON del estilo
// {
//     user: user,
//     password: password
// }
router.post("/login", auth, async (req, res) => {
  try {
    if (req.body.user == process.env.USER_ADMIN) {
      if (await bcrypt.compare(req.body.password, process.env.CLAVE_HASHEADA_ADMIN)) res.json({ correcto: true });
      else res.status(401).json({ correcto: false });
    } else res.status(401).json({ correcto: false });
  } catch (err) {
    res.status(401).json({ message: err });
  }
});

// pasar JSON del estilo:
// {
//     "emailUsuario": "String", (puede ser ID sino, como quieras)
//     "estado": "aceptado/revision/rechazado/pendiente (este último si aún no lo revisó)",
//     "mensajeMedico": vacío si aceptado, completo si pide revisión
// }
router.post("/respuesta", auth, async (req, res) => {
  try {
    const request = req.body;
    sendEmailAdmin(request.emailUsuario, request.estado);
    switch (request.estado) {
      case "aceptado":
        var numeroPasaporteActual = await Usuario.find({
          estado: "aceptado",
        }).countDocuments();
        const user = await Usuario.findOne({
          correoElectronico: request.emailUsuario,
        });
        if (user.estado == "aceptado") numeroPasaporteActual = user.numeroPasaporte - 1;
        var updatedUser = await Usuario.updateOne(
          { correoElectronico: request.emailUsuario },
          {
            $set: {
              estado: "aceptado",
              numeroPasaporte: numeroPasaporteActual + 1001,
            },
          }
        );

        res.json(updatedUser);
        break;

      case "revision":
        var updatedUser = await Usuario.updateOne(
          { correoElectronico: request.emailUsuario },
          {
            $set: { mensajeMedico: request.mensajeMedico, estado: "revision" },
          }
        );
        res.json(updatedUser);
        break;

      case "rechazado":
        var updatedUser = await Usuario.updateOne(
          { correoElectronico: request.emailUsuario },
          {
            $set: { mensajeMedico: request.mensajeMedico, estado: "rechazado" },
          }
        );
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
router.post("/solicitudes", auth, async (req, res) => {
  try {
    if (req.body.condicion == "") var usuarios = await Usuario.find();
    else var usuarios = await Usuario.find({ estado: req.body.condicion });
    res.json(usuarios);
  } catch (err) {
    console.log(err);
    res.status(401).json({ message: err });
  }
});

router.post("/modificarSolicitud", auth, async (req, res) => {
  try {
    var numeroPasaporteActual = await Usuario.find({
      estado: "aceptado",
    }).countDocuments();
    const modifiedUser = req.body;
    const user = await Usuario.findOne({
      _id: modifiedUser.id,
    });
    if (user.estado == "aceptado") numeroPasaporteActual = user.numeroPasaporte - 1;
    var updatedUser = await Usuario.updateOne(
      { _id: modifiedUser.id },
      {
        $set: {
          nombre: modifiedUser.nombre,
          apellidos: modifiedUser.apellidos,
          correoElectronico: modifiedUser.correoElectronico,
          fechaNacimiento: modifiedUser.fechaNacimiento,
          localidadResidencia: modifiedUser.localidadResidencia,
          lugarNacimiento: modifiedUser.lugarNacimiento,
          numeroDocumento: modifiedUser.numeroDocumento,
          numeroTelefono: modifiedUser.numeroTelefono,
          paisResidencia: modifiedUser.paisResidencia,
          diagnostico: {
            dislexia: modifiedUser.dislexia,
            discalculia: modifiedUser.discalculia,
            disortografía: modifiedUser.disortografía,
            dispraxia: modifiedUser.dispraxia,
            tdah: modifiedUser.tdah,
          },
          estado: "aceptado",
          numeroPasaporte:
            modifiedUser.numeroPasaporte != null ? modifiedUser.numeroPasaporte : numeroPasaporteActual + 1001,
        },
      }
    );

    res.json({ message: "Usuario actualizado correctamente!" });
  } catch (err) {
    res.status(500).json({ message: "Hubo un error", err });
  }
});

router.post("/solicitudes/:id", auth, async (req, res) => {
  try {
    const usuario = await Usuario.findOne({ _id: req.params.id });
    res.json({ usuario });
  } catch (err) {
    res.status(401).json({ message: err });
  }
});

router.get("/excel", auth, async (req, res) => {
  try {
    var usuarios = await Usuario.find();

    var wb = new xl.Workbook();
    var ws = wb.addWorksheet("Sheet 1");
    var headerStyle = wb.createStyle({
      font: {
        bold: true,
      },
    });

    const xlsxHeaders = [
      // [título en el encabezado, atributo en el schema, tipo de dato en la celda]
      ["Estado", "estado", "string"],
      ["Mensaje del médico", "mensajeMedico", "string"],
      ["Nro. de pasaporte", "numeroPasaporte", "string"],
      ["Nro. de documento", "numeroDocumento", "string"],
      ["Nombre", "nombre", "string"],
      ["Apellidos", "apellidos", "string"],
      ["Correo electrónico", "correoElectronico", "string"],
      ["País de residencia", "paisResidencia", "string"],
      ["Localidad", "localidadResidencia", "string"],
      ["Lugar de nacimiento", "lugarNacimiento", "string"],
      ["Fecha de nacimiento", "fechaNacimiento", "date"],
      ["Nro. teléfono", "numeroTelefono", "string"],
      ["Fecha de creación", "fechaCreacion", "date"],
    ];
    for (var i = 1; i <= xlsxHeaders.length; i++) {
      ws.cell(1, i)
        .string(xlsxHeaders[i - 1][0])
        .style(headerStyle);
    }

    for (var i = 0; i < usuarios.length; i++) {
      for (var j = 0; j < xlsxHeaders.length; j++) {
        ws.cell(i + 2, j + 1)[xlsxHeaders[j][2]](usuarios[i][xlsxHeaders[j][1]].toString());
      }
    }

    wb.write("Usuarios.xlsx", res);
  } catch (err) {
    console.log(err);
    res.json({ message: err });
  }
});

module.exports = router;
