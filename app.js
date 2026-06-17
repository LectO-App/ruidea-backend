const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const fileUpload = require("express-fileupload");
const pinoHttp = require("pino-http");

require("dotenv/config");

const logger = require("./functions/logger");

// Safety net: Express 4 does not forward rejections from async route handlers to the
// error handler, so one stray rejection would otherwise crash the process. Log and
// keep serving; the client request that triggered it still fails on its own.
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
process.on("uncaughtException", (err) => logger.error({ err }, "uncaughtException"));

app.set("trust proxy", 1); // behind Azure's proxy: needed for secure cookies + real client IP

app.use(helmet());
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(
  fileUpload({
    limits: { fileSize: 10 * 1024 * 1024, files: 10 }, // 10 MB/file, 10 files max
    abortOnLimit: true,
    responseOnLimit: "El archivo excede el tamaño máximo permitido.",
  })
);

// CORS: explicit allowlist + credentials (cookies). Replaces origin:"*" (§4.1).
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / server-to-server (no Origin header) and allowlisted origins.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origen no permitido por CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Verifier-Key"],
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

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 404
app.use((req, res) => {
  res.status(404).json({ message: "No encontrado" });
});

// Central error handler: log details server-side, return a generic message (§4.5).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (req.log) req.log.error({ err }, "unhandled error");
  else logger.error({ err }, "unhandled error");
  if (err && err.message && err.message.includes("CORS")) {
    return res.status(403).json({ message: "Origen no permitido" });
  }
  res.status(500).json({ message: "Error interno del servidor" });
});

// Connecting to data-base (mongoose 8: promise-based, no deprecated options)
mongoose.set("strictQuery", true);
mongoose
  .connect(process.env.DB_CONNECTION)
  .then(() => logger.info("Connected to DB"))
  .catch((err) => logger.error({ err }, "DB connection failed"));

app.listen(process.env.PORT || 3001, () => {
  logger.info(`Server listening on ${process.env.PORT || 3001}`);
});

module.exports = app;
