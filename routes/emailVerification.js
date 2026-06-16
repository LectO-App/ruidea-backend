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

module.exports = router;
