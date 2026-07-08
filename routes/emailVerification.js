const express = require("express");
const router = express.Router();
const Usuario = require("../models/modeloUsuario");
const { verifyToken } = require("../functions/tokens");
const { authUser } = require("../middlewares/session");
const { emailLimiter } = require("../middlewares/rate-limit");

const { sendEmail } = require("../functions/sendEmail");

router.post("/confirm/:token", async (req, res) => {
  try {
    const payload = verifyToken(req.params.token);
    if (payload.purpose !== "email-verify")
      return res.status(400).json({ message: "Token inválido o expirado." });
    const user = await Usuario.findById(payload.id);
    if (!user) return res.status(400).send("No se encontró ningún usuario con ese ID.");

    user.emailVerificado = true;
    await user.save();
    res.send("Usuario verificado!");
  } catch (err) {
    return res.status(400).json({ message: "Token inválido o expirado." });
  }
});

// Resend verification to the AUTHENTICATED user only (no arbitrary :id, rate-limited)
// — closes the unauthenticated outbound-email abuse vector (§11.2).
router.post("/resend", authUser, emailLimiter, async (req, res) => {
  try {
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
    if (user && !user.emailVerificado) {
      await sendEmail(user.id);
    }
    res.send("Si la cuenta necesita verificación, le hemos enviado un nuevo correo.");
  } catch (err) {
    // Malformed/forged token (bad signature) — verifyToken throws. Don't leak details.
    return res.status(400).json({ message: "Token inválido." });
  }
});

module.exports = router;
