const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const mongodb = require("mongodb");
const fileUpload = require("express-fileupload");

require("dotenv/config");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());

// Import routes
const inscripcionRoutes = require("./routes/inscripcion");
const adminRoutes = require("./routes/admin");
const usuarioRoutes = require("./routes/usuario");
const uploadFile = require("./prueba-archivos.js");

// MIDDLEWAREs
app.use(cors());
app.use("/admin", adminRoutes);
app.use("/inscripcion", inscripcionRoutes);
app.use("/usuario", usuarioRoutes);
app.use("/subir-archivo", uploadFile);

// ROUTES
app.get("/", (req, res) => {
  res.send("We are on home");
});

// Connecting to data-base
mongoose.connect(
  process.env.DB_CONNECTION,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
    useFindAndModify: false,
  },
  () => {
    console.log("Conncected to DB");
  }
);

app.listen(process.env.PORT || 3000);
