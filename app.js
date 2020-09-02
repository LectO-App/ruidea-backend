const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const fileUpload = require("express-fileupload");

require("dotenv/config");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use(
  cors({
    origin: "*",
  })
);

// Import routes
const inscripcionRoutes = require("./routes/inscripcion");
const adminRoutes = require("./routes/admin");
const usuarioRoutes = require("./routes/usuario");
const emailVerificationRoutes = require("./routes/emailVerification");

// MIDDLEWAREs
app.use("/admin", adminRoutes);
app.use("/inscripcion", inscripcionRoutes);
app.use("/usuario", usuarioRoutes);
app.use("/emailVerification", emailVerificationRoutes);

// ROUTES
app.get("/", (req, res) => {
  res.send("We are on home guys!!!");
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
    console.log("Conncected to DB!!!");
  }
);

app.listen(process.env.PORT || 3001);
