const express = require("express");
const router = express.Router();
const Usuario = require("../models/modeloUsuario");
const { isValidObjectId: isValidId } = require("../db/objectId");
const bcrypt = require("bcrypt");
const xl = require("excel4node");

const { sendEmailAdmin, sendEmail, sendDraftReminderEmail, sendDraftCancelledEmail } = require("../functions/sendEmail");
const { issueSession, clearSession, authAdmin } = require("../middlewares/session");
const { authLimiter, emailLimiter } = require("../middlewares/rate-limit");
const { validate } = require("../middlewares/validate");
const schemas = require("../validation/schemas");
const { nextPassporte } = require("../functions/passport");
const { writeAudit } = require("../functions/audit");
const { warmPassport } = require("../functions/passportRender");
const { isPassportNumberTaken } = require("../db/prisma");
const { getStats } = require("../functions/stats");
const { REMINDER_ACTION, draftProgress, lastReminders } = require("../functions/drafts");
const { deleteUserDocuments, logBlobError } = require("../functions/blob");

// Issued passport numbers are unique (unique index). Collisions answer 409 instead of 500.
const PASSPORT_TAKEN = { message: "Ese número de pasaporte ya está asignado a otra persona." };
const PASSPORT_RACE = { message: "No se pudo asignar un número de pasaporte libre. Inténtalo de nuevo." };

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
    const user = await Usuario.findByEmail(emailUsuario);
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    if (estado === "aceptado") {
      // Keep an existing passport number; otherwise allocate atomically (§5.1).
      const numero = user.numeroPasaporte >= 1000 ? user.numeroPasaporte : await nextPassporte();
      await Usuario.updateById(user._id, { estado: "aceptado", numeroPasaporte: numero });
      // Pre-render the passport so the user's first download is instant.
      user.estado = "aceptado";
      user.numeroPasaporte = numero;
      warmPassport(user);
    } else {
      await Usuario.updateById(user._id, { estado, mensajeMedico: mensajeMedico || "" });
    }

    // Fire-and-forget: don't block the admin response on a slow SMTP round-trip.
    sendEmailAdmin(emailUsuario, estado, mensajeMedico).catch(err => req.log && req.log.error({ err }, "respuesta email failed"));
    writeAudit(req, { action: "admin.respuesta", actorType: "admin", target: String(user._id), outcome: "success", meta: { estado } });
    res.json({ ok: true });
  } catch (err) {
    req.log && req.log.error({ err }, "respuesta failed");
    if (isPassportNumberTaken(err)) return res.status(409).json(PASSPORT_RACE);
    res.status(500).json({ message: "Hubo un error" });
  }
});

router.post("/solicitudes", authAdmin, validate(schemas.solicitudesSchema), async (req, res) => {
  try {
    // Default view hides incomplete drafts (borrador); admin can still ask for them
    // explicitly via condicion='borrador', or for everything (drafts included) via 'todas'.
    const filter =
      req.body.condicion === "todas"
        ? {}
        : req.body.condicion
          ? { estado: req.body.condicion }
          : { estadoNot: "borrador" };
    const usuarios = await Usuario.find(filter, { sort: "newest" });
    const drafts = usuarios.filter(u => u.estado === "borrador");
    const reminders = await lastReminders(drafts.map(u => u._id));
    for (const u of drafts) {
      u.progreso = draftProgress(u);
      if (reminders.has(u._id)) u.ultimoRecordatorio = reminders.get(u._id);
    }
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
    else if (await Usuario.passportNumberTaken(numero, user._id)) return res.status(409).json(PASSPORT_TAKEN);

    await Usuario.updateById(m.id, {
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
    });
    // Pre-render the updated passport (fresh doc) so the first download is instant.
    Usuario.findById(m.id).then(u => u && warmPassport(u)).catch(() => {});
    writeAudit(req, { action: "admin.modificar", actorType: "admin", target: String(m.id), outcome: "success" });
    res.json({ message: "Usuario actualizado correctamente!" });
  } catch (err) {
    req.log && req.log.error({ err }, "modificarSolicitud failed");
    if (isPassportNumberTaken(err)) return res.status(409).json(PASSPORT_TAKEN);
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

const NOT_FOUND = { message: "Usuario no encontrado" };
const NOT_A_DRAFT = { message: "Esta solicitud ya fue enviada. Solo se puede hacer esto con solicitudes sin terminar." };

// Unfinished application (estado 'borrador'): sends the person a reminder that it was not
// sent yet, listing the missing steps. Fire-and-forget like /resend.
router.post("/borradores/:id/recordatorio", authAdmin, emailLimiter, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json(NOT_FOUND);
    const user = await Usuario.findById(req.params.id);
    if (!user) return res.status(404).json(NOT_FOUND);
    if (user.estado !== "borrador") return res.status(409).json(NOT_A_DRAFT);

    const pendientes = draftProgress(user).pasos.filter(p => !p.completo).map(p => p.titulo);
    sendDraftReminderEmail(user, pendientes).catch(err => req.log && req.log.error({ err }, "draft reminder email failed"));
    writeAudit(req, { action: REMINDER_ACTION, actorType: "admin", target: user._id, outcome: "success" });
    res.json({ ok: true, ultimoRecordatorio: new Date() });
  } catch (err) {
    req.log && req.log.error({ err }, "draft reminder failed");
    res.status(500).json({ message: "No se pudo enviar el recordatorio" });
  }
});

// Cancels an unfinished application: deletes the record and every uploaded document, so the
// person can register again with the same email. `avisar` emails them that it was cancelled.
router.post("/borradores/:id/cancelar", authAdmin, emailLimiter, validate(schemas.cancelarBorradorSchema), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json(NOT_FOUND);
    const current = await Usuario.findById(req.params.id);
    if (!current) return res.status(404).json(NOT_FOUND);
    if (current.estado !== "borrador") return res.status(409).json(NOT_A_DRAFT);

    const user = await Usuario.deleteDraftById(req.params.id);
    if (!user) return res.status(409).json(NOT_A_DRAFT);
    const docs = await deleteUserDocuments(user._id, user.archivoBlob);
    if (docs.failed) logBlobError(req, docs.error, "draft documents not fully deleted", { failed: docs.failed });

    const { avisar } = req.body;
    if (avisar) sendDraftCancelledEmail(user).catch(err => req.log && req.log.error({ err }, "draft cancelled email failed"));
    writeAudit(req, { action: "admin.draft_cancel", actorType: "admin", target: user._id, outcome: "success", meta: { avisado: avisar } });
    res.json({ ok: true });
  } catch (err) {
    req.log && req.log.error({ err }, "draft cancel failed");
    res.status(500).json({ message: "No se pudo cancelar la solicitud" });
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

const DAY_MS = 24 * 60 * 60 * 1000;

// Usage statistics, aggregates only (functions/stats.js). Dates are UTC days, both inclusive.
router.get("/estadisticas", authAdmin, async (req, res) => {
  const parsed = schemas.estadisticasQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Datos inválidos",
      errors: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const { desde, hasta } = parsed.data;
  try {
    const stats = await getStats({
      desde: desde ? new Date(`${desde}T00:00:00Z`) : null,
      hasta: hasta ? new Date(Date.parse(`${hasta}T00:00:00Z`) + DAY_MS) : null,
    });
    res.json({ rango: { desde: desde || null, hasta: hasta || null }, ...stats });
  } catch (err) {
    req.log && req.log.error({ err }, "estadisticas failed");
    res.status(500).json({ message: "No se pudieron calcular las estadísticas" });
  }
});

router.get("/excel", authAdmin, async (req, res) => {
  try {
    const usuarios = await Usuario.find({ estadoNot: "borrador" });
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
