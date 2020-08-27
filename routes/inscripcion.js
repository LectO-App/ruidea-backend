const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const Usuario = require("../models/modeloUsuario");
const auth = require("../middlewares/request-auth");
const AWS = require("aws-sdk");
const Zip = require("jszip");
const fs = require("fs");
const Client = require("ftp");

router.get("/", auth, async (req, res) => {
  try {
    const users = await Usuario.find();
    res.json(users);
  } catch (err) {
    res.json({ message: err });
  }
});

// pasar modeloUsuario
router.post("/", auth, async (req, res) => {
  const user = req.body;

  try {
    user.password = await bcrypt.hash(user.password, 10);
    user.fechaNacimiento = new Date(user.fechaNacimiento);
    user.fechaCreacion = Date.now();
    user.linkArchivos = `ftp://pasaporte%2540dea.ong@caebes-cp50.wordpresstemporal.com/${user.correoElectronico}`;

    const savedUser = await Usuario(user).save();

    // RESPUESTA
    res.json(savedUser);
  } catch (err) {
    console.log(err);
    res.status(401).json({ message: err });
  }
});

router.post("/subir-archivos/:email", async (req, res) => {
  try {
    const email = req.params.email;

    /* const BUCKET_NAME = "ruidea";
    const s3 = new AWS.S3();

    const zip = new Zip();

    for (file of Object.values(req.files)) {
      zip.file(file.name, file.data);
    }
    zip
      .generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: {
          level: 9,
        },
      })
      .then((buffer) => {
        console.log(buffer);

        const params = {
          Bucket: BUCKET_NAME,
          CreateBucketConfiguration: {
            LocationConstraint: "us-east-1",
          },
          Key: `${email}/${new Date().toLocaleString()} - ${email}.zip`,
          Body: buffer,
        };

        s3.upload(params, function (err, data) {
          if (err) {
            throw err;
          }
          console.log(`File uploaded successfully. ${data.Location}`);
        });
      });

    res.send("El archivo se subió correctamente!"); */

    const c = new Client();

    c.on("ready", () => {
      c.mkdir(`./${email}`, true, (err) => {
        if (err) throw err;
        for (file of Object.values(req.files)) {
          c.put(
            file.data,
            `${email}/(${new Date().toLocaleString()}) ${file.name}`,
            (err) => {
              if (err) throw err;
              c.end();
            }
          );
        }

        res.json({
          message: "Funciona!",
          link: `ftp://pasaporte%2540dea.ong@caebes-cp50.wordpresstemporal.com/${email}`,
        });
      });
    });

    c.connect({
      host: "caebes-cp50.wordpresstemporal.com",
      posrt: 21,
      user: "pasaporte@dea.ong",
      password: "Dislexia123",
      connTimeout: 30000,
      pasvTimeout: 30000,
    });
  } catch (err) {
    console.log(err);
  }
});

router.put("/actualizar", auth, async (req, res) => {
  try {
    const user = req.body;
    const update = await Usuario.findOneAndUpdate(
      { _id: user._id },
      {
        $set: {
          nombre: user.nombre,
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
            tdah: user["diagnostico"].tdah,
          },
          linkArchivos: user.linkArchivos,
          password: await bcrypt.hash(user.password, 10),
          fechaCreacion: Date.now(),
          estado: "pendiente",
        },
      }
    );
    res.json({ update });
  } catch (err) {
    console.log(err);
    res.json({ message: err }).status(401);
  }
});

// pasar json del estilo:
// {
//     mail: correoElectronico
// }
router.post("/comprobar-mail", auth, async (req, res) => {
  try {
    const user = await Usuario.exists({ correoElectronico: req.body.mail });
    console.log(user);
    if (user) res.json({ disponible: false });
    else res.json({ disponible: true });
  } catch (err) {
    res.json({ message: err });
  }
});

// ignorar
router.post("/borrar", auth, async (req, res) => {
  try {
    const users = await Usuario.deleteMany();
    res.json(users);
  } catch (err) {
    console.log(err);
    res.status(401).json({ message: err });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const user = await Usuario.findByIdAndDelete(req.params.id);
    res.json({ message: "Eliminado", user });
  } catch (err) {
    console.log(err);
    res.status(401).json({ message: err });
  }
});

module.exports = router;
