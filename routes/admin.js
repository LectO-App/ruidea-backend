const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Usuario = require("../models/modeloUsuario");
const bcrypt = require("bcrypt");
const xl = require("excel4node");

const isValidId = (id) => mongoose.isValidObjectId(id);

const { sendEmailAdmin, sendEmail } = require("../functions/sendEmail");
const { issueSession, clearSession, authAdmin } = require("../middlewares/session");
const { authLimiter } = require("../middlewares/rate-limit");
const { validate } = require("../middlewares/validate");
const schemas = require("../validation/schemas");
const { nextPassporte } = require("../functions/passport");
const { writeAudit } = require("../functions/audit");
const { warmPassport } = require("../functions/passportRender");

// Admin login issues a real server-side admin session cookie (§1.3). No more shared
// authkey + client-set `admin=true`.
router.post("/login", authLimiter, validate(schemas.adminLoginSchema), async (req, res) => {
  try {
    const { user, password } = req.body;
    const userOk = user === process.env.USER_ADMIN;
    const passOk = userOk && (await bcrypt.compare(password, process.env.CLAVE_HASHEADA_ADMIN));
    if (!userOk || !passOk) {
      writeAudit(req, { action: "admin.login", outcome: "denied" });
      return res.status(401).json({ correcto: false });
    }
    const csrf = issueSession(res, { id: "admin", role: "admin" });
    writeAudit(req, { action: "admin.login", actorType: "admin", outcome: "success" });
    res.json({ correcto: true, csrfToken: csrf });
  } catch (err) {
    req.log && req.log.error({ err }, "admin login failed");
    res.status(401).json({ correcto: false });
  }
});

router.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// Lets the SPA confirm an active admin session without trusting a client cookie.
router.get("/me", authAdmin, (req, res) => {
  res.json({ admin: true, csrfToken: req.user.csrf });
});

router.post("/respuesta", authAdmin, validate(schemas.respuestaSchema), async (req, res) => {
  try {
    const { emailUsuario, estado, mensajeMedico } = req.body;
    const user = await Usuario.findOne({ correoElectronico: emailUsuario });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    if (estado === "aceptado") {
      // Keep an existing passport number; otherwise allocate atomically (§5.1).
      const numero = user.numeroPasaporte >= 1000 ? user.numeroPasaporte : await nextPassporte();
      await Usuario.updateOne({ _id: user._id }, { $set: { estado: "aceptado", numeroPasaporte: numero } });
      // Pre-render the passport so the user's first download is instant.
      user.estado = "aceptado";
      user.numeroPasaporte = numero;
      warmPassport(user);
    } else {
      await Usuario.updateOne({ _id: user._id }, { $set: { estado, mensajeMedico: mensajeMedico || "" } });
    }

    // Fire-and-forget: don't block the admin response on a slow SMTP round-trip.
    sendEmailAdmin(emailUsuario, estado, mensajeMedico).catch(err => req.log && req.log.error({ err }, "respuesta email failed"));
    writeAudit(req, { action: "admin.respuesta", actorType: "admin", target: String(user._id), outcome: "success", meta: { estado } });
    res.json({ ok: true });
  } catch (err) {
    req.log && req.log.error({ err }, "respuesta failed");
    res.status(500).json({ message: "Hubo un error" });
  }
});

router.post("/solicitudes", authAdmin, validate(schemas.solicitudesSchema), async (req, res) => {
  try {
    // Default view hides incomplete drafts (borrador); admin can still ask for them
    // explicitly via condicion='borrador'.
    const filter = req.body.condicion ? { estado: req.body.condicion } : { estado: { $ne: "borrador" } };
    const usuarios = await Usuario.find(filter).sort({ fechaCreacion: -1 });
    res.json(usuarios);
  } catch (err) {
    req.log && req.log.error({ err }, "solicitudes failed");
    res.status(500).json({ message: "Error interno" });
  }
});

router.post("/modificarSolicitud", authAdmin, validate(schemas.modificarSchema), async (req, res) => {
  try {
    const m = req.body;
    const user = await Usuario.findById(m.id);
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    let numero = m.numeroPasaporte != null ? m.numeroPasaporte : user.numeroPasaporte;
    if (numero == null || numero < 1000) numero = await nextPassporte();

    await Usuario.updateOne(
      { _id: m.id },
      {
        $set: {
          nombre: m.nombre,
          apellidos: m.apellidos,
          correoElectronico: m.correoElectronico,
          fechaNacimiento: new Date(m.fechaNacimiento),
          localidadResidencia: m.localidadResidencia,
          lugarNacimiento: m.lugarNacimiento,
          numeroDocumento: m.numeroDocumento,
          numeroTelefono: m.numeroTelefono,
          paisResidencia: m.paisResidencia,
          diagnostico: {
            dislexia: !!m.dislexia,
            discalculia: !!m.discalculia,
            disortografía: !!m.disortografía,
            dispraxia: !!m.dispraxia,
            tdah: !!m.tdah,
          },
          estado: "aceptado",
          numeroPasaporte: numero,
        },
      }
    );
    // Pre-render the updated passport (fresh doc) so the first download is instant.
    Usuario.findById(m.id).then(u => u && warmPassport(u)).catch(() => {});
    writeAudit(req, { action: "admin.modificar", actorType: "admin", target: String(m.id), outcome: "success" });
    res.json({ message: "Usuario actualizado correctamente!" });
  } catch (err) {
    req.log && req.log.error({ err }, "modificarSolicitud failed");
    res.status(500).json({ message: "Hubo un error" });
  }
});

// Admin resends a verification email to a specific user.
router.post("/resend/:id", authAdmin, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: "Usuario no encontrado" });
    // Fire-and-forget: respond immediately, don't block on SMTP.
    sendEmail(req.params.id).catch(err => req.log && req.log.error({ err }, "admin resend failed"));
    writeAudit(req, { action: "admin.resend_verification", actorType: "admin", target: req.params.id, outcome: "success" });
    res.json({ ok: true });
  } catch (err) {
    req.log && req.log.error({ err }, "admin resend failed");
    res.status(400).json({ message: "No se pudo enviar el email" });
  }
});

router.post("/solicitudes/:id", authAdmin, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json({ usuario });
  } catch (err) {
    res.status(400).json({ message: "Solicitud inválida" });
  }
});

router.get("/excel", authAdmin, async (req, res) => {
  try {
    const usuarios = await Usuario.find({ estado: { $ne: "borrador" } });
    const wb = new xl.Workbook();
    const ws = wb.addWorksheet("Sheet 1");
    const headerStyle = wb.createStyle({ font: { bold: true } });

    const xlsxHeaders = [
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
    for (let i = 1; i <= xlsxHeaders.length; i++) {
      ws.cell(1, i).string(xlsxHeaders[i - 1][0]).style(headerStyle);
    }
    for (let i = 0; i < usuarios.length; i++) {
      for (let j = 0; j < xlsxHeaders.length; j++) {
        const value = usuarios[i][xlsxHeaders[j][1]];
        const cell = ws.cell(i + 2, j + 1);
        if (value == null) cell.string("");
        else if (xlsxHeaders[j][2] === "date") cell.string(new Date(value).toISOString());
        else cell.string(value.toString());
      }
    }

    writeAudit(req, { action: "admin.export_excel", actorType: "admin", outcome: "success", meta: { count: usuarios.length } });
    wb.write("Usuarios.xlsx", res);
  } catch (err) {
    req.log && req.log.error({ err }, "excel failed");
    res.status(500).json({ message: "Error interno" });
  }
});

module.exports = router;
