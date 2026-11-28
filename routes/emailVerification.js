const express = require("express");
const router = express.Router();
const Usuario = require("../models/modeloUsuario");
const { verifyToken } = require("../functions/tokens");
const { authUser } = require("../middlewares/session");
const { emailLimiter } = require("../middlewares/rate-limit");

const { sendEmail } = require("../functions/sendEmail");
const { validate } = require("../middlewares/validate");
const { emailCodeSchema, emailChangeSchema } = require("../validation/schemas");
const { writeAudit } = require("../functions/audit");
const { isUniqueViolation } = require("../db/prisma");
const { tokenMatchesAddress, codeMatches, triesLeft, recordWrongTry, clearWrongTries } = require("../functions/emailCode");

const INVALID_LINK = { message: "Token inválido o expirado." };

router.post("/confirm/:token", async (req, res) => {
  try {
    const payload = verifyToken(req.params.token);
    if (payload.purpose !== "email-verify") return res.status(400).json(INVALID_LINK);
    const user = await Usuario.findById(payload.id);
    if (!user) return res.status(400).send("No se encontró ningún usuario con ese ID.");
    // A link sent to an address the account no longer has confirms nothing.
    if (!tokenMatchesAddress(payload, user.correoElectronico)) return res.status(400).json(INVALID_LINK);

    await Usuario.save(user, { emailVerificado: true });
    res.send("Usuario verificado!");
  } catch (err) {
    return res.status(400).json(INVALID_LINK);
  }
});

// Resend verification to the AUTHENTICATED user only (no arbitrary :id, rate-limited)
// — closes the unauthenticated outbound-email abuse vector (§11.2).
const DRAFT_NOT_SENT = {
  message: "Tu solicitud aún no está enviada. Termina el formulario y envíala; después te mandaremos el correo.",
};

router.post("/resend", authUser, emailLimiter, async (req, res) => {
  try {
    const user = await Usuario.findById(req.user.id);
    if (user && user.estado === "borrador") return res.status(409).json(DRAFT_NOT_SENT);
    await sendEmail(req.user.id);
    res.send("Email de verificación enviado nuevamente");
  } catch (err) {
    req.log && req.log.error({ err }, "resend failed");
    res.status(400).send("No se pudo enviar el email");
  }
});

// Self-serve resend from the (usually expired) verification link. Unauthenticated, but
// safe: it requires possession of a server-signed email-verify token, so it can only ever
// re-send to that token's own user — never an arbitrary address. Rate-limited like the
// other outbound-email endpoints. The token is decoded ignoring expiry (the whole point is
// that it expired). Responds 200 whether or not a mail was sent so it can't be used to
// probe which accounts exist or are already verified.
router.post("/resend/:token", emailLimiter, async (req, res) => {
  try {
    const payload = verifyToken(req.params.token, { ignoreExpiration: true });
    if (payload.purpose !== "email-verify")
      return res.status(400).json({ message: "Token inválido." });

    const user = await Usuario.findById(payload.id);
    // A draft gets nothing: the verification email is only for sent applications.
    // A link sent to an earlier address triggers nothing. Links from before the address
    // binding (no `eh` claim) still get a fresh email, which goes to the current address.
    const sentToOldAddress = user && payload.eh !== undefined && !tokenMatchesAddress(payload, user.correoElectronico);
    if (user && !user.emailVerificado && user.estado !== "borrador" && !sentToOldAddress) {
      await sendEmail(user.id);
    }
    res.send("Si la cuenta necesita verificación, le hemos enviado un nuevo correo.");
  } catch (err) {
    // Malformed/forged token (bad signature) — verifyToken throws. Don't leak details.
    return res.status(400).json({ message: "Token inválido." });
  }
});

const ALREADY_VERIFIED = { message: "Tu correo ya está confirmado. No hace falta hacer nada más." };
const WRONG_CODE = { message: "El código no es correcto. Revisa el último correo que te enviamos y escribe los 6 números." };
const TOO_MANY_TRIES = {
  message: "Has escrito el código mal varias veces. Espera una hora y vuelve a probar, o pulsa el botón del correo.",
};
const SAVED_NOT_SENT = "Guardamos tu correo, pero no pudimos enviarte el código. Pulsa «Reenviar el correo».";
const EMAIL_TAKEN = {
  message: "Ya hay una cuenta con este correo. Si es tuya, entra con ese correo. Si no, escribe otro.",
};

// The 6-digit code from the verification email, typed in the panel of the signed-in account.
router.post("/codigo", authUser, emailLimiter, validate(emailCodeSchema), async (req, res) => {
  try {
    const user = await Usuario.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "No encontramos tu cuenta." });
    if (user.emailVerificado) return res.json({ emailVerificado: true });
    if (user.estado === "borrador") return res.status(409).json(DRAFT_NOT_SENT);
    if (triesLeft(user.id) === 0) return res.status(429).json(TOO_MANY_TRIES);

    if (!codeMatches(user.id, user.correoElectronico, req.body.codigo)) {
      recordWrongTry(user.id);
      writeAudit(req, { action: "user.email_code", actorType: "user", actorId: String(user.id), outcome: "denied" });
      return res.status(400).json(triesLeft(user.id) === 0 ? TOO_MANY_TRIES : WRONG_CODE);
    }

    await Usuario.save(user, { emailVerificado: true });
    clearWrongTries(user.id);
    writeAudit(req, { action: "user.email_code", actorType: "user", actorId: String(user.id), outcome: "success" });
    res.json({ emailVerificado: true });
  } catch (err) {
    req.log && req.log.error({ err }, "email code check failed");
    res.status(500).json({ message: "No pudimos comprobar el código. Inténtalo de nuevo en un momento." });
  }
});

// Fixes a mistyped address before it is confirmed. Only the address changes; the new one
// gets a fresh link and code, and the old one gets nothing (it may belong to a stranger).
router.post("/correo", authUser, emailLimiter, validate(emailChangeSchema), async (req, res) => {
  const { correoElectronico } = req.body;
  try {
    const user = await Usuario.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "No encontramos tu cuenta." });
    if (user.emailVerificado) return res.status(409).json(ALREADY_VERIFIED);
    if (user.estado === "borrador") return res.status(409).json(DRAFT_NOT_SENT);

    if (correoElectronico !== user.correoElectronico) {
      if (await Usuario.emailExists(correoElectronico)) return res.status(409).json(EMAIL_TAKEN);
      try {
        await Usuario.updateById(user.id, { correoElectronico });
      } catch (err) {
        if (isUniqueViolation(err)) return res.status(409).json(EMAIL_TAKEN);
        throw err;
      }
      clearWrongTries(user.id);
      writeAudit(req, { action: "user.email_change", actorType: "user", actorId: String(user.id), outcome: "success" });
    }

    try {
      await sendEmail(user.id);
    } catch (err) {
      req.log && req.log.error({ err }, "verification email after email change failed");
      return res.status(502).json({ message: SAVED_NOT_SENT });
    }
    res.json({ correoElectronico });
  } catch (err) {
    req.log && req.log.error({ err }, "email change failed");
    res.status(500).json({ message: "No pudimos cambiar el correo. Inténtalo de nuevo en un momento." });
  }
});

module.exports = router;
