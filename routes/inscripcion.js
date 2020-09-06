const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const Usuario = require("../models/modeloUsuario");
const auth = require("../middlewares/request-auth");
/* const AWS = require("aws-sdk");
const jwt = require("jsonwebtoken");
*/
const Zip = require("jszip");
const azureStorage = require("azure-storage");
const getStream = require("into-stream");

const { sendEmail } = require("../functions/sendEmail");

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

    await Usuario(user).save(async (err, user) => {
      if (err) {
        return res.status(401).json(err);
      }
      await sendEmail(user._id);
      res.json(user);
    });
  } catch (err) {
    console.log(err);
    res.status(401).json({ message: err });
  }
});

router.post("/subir-archivos/:email", async (req, res) => {
  if (!req.files) {
    return res.status(400).send("Por favor envia un archivo");
  }
  try {
    const email = req.params.email;
    const blobService = azureStorage.createBlobService();

    const zip = new Zip();

    for (let file of Object.values(req.files)) {
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
        const stream = getStream(buffer);
        const blobName = `${email}/${new Date().toISOString()} - ${email}.zip`;

        const streamLength = buffer.length;
        blobService.createBlockBlobFromStream(
          "ruidea",
          blobName,
          stream,
          streamLength,
          (error) => {
            if (error) {
              console.log(error);
            } else {
              res.send("Subida");
            }
          }
        );

        /* const params = {
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
        }); */
      });

    /* const BUCKET_NAME = "ruidea";
    const s3 = new AWS.S3();


      

    res.send("El archivo se subió correctamente!"); */

    /* const c = new Client();

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
    });*/
  } catch (err) {
    console.log(err);
  }
});

router.get("/link-archivos/:id", async (req, res) => {
  try {
    const blobService = azureStorage.createBlobService();

    const user = await Usuario.findById(req.params.id);

    blobService.listBlobsSegmentedWithPrefix(
      "ruidea",
      `${user.correoElectronico}/`,
      undefined,
      async (error, result) => {
        if (error) return console.log(error);
        const entries = result.entries;

        let newest = new Date(0);
        let fileToDownload = {};

        for await (let file of entries) {
          const date = new Date(file.name.split("/")[1].split(" -")[0]);
          if (date > newest) {
            newest = date;
            fileToDownload = file;
          }
        }

        res.send(
          `https://ruidea.blob.core.windows.net/ruidea/${fileToDownload.name}`
        );
      }
    );
  } catch (err) {
    res.status(400).send(err);
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
