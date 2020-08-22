module.exports = (req, res, next) => {
  const token = req.headers.authkey;
  if (!token) return res.status(401).send("Ingrese una contraseña");
  if (token !== process.env.SECURITY_KEY) {
    return res.status(401).send("Contraseña incorrecta!");
  } else {
    next();
  }
};
