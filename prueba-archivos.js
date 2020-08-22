const express = require("express");
const router = express.Router();
const Client = require("ftp");

router.post("/", async (req, res) => {
  try {
    var c = new Client();
    c.on("ready", () => {
      c.mkdir(`/${req.body.id}`, (err) => {
        if (err) throw err;
        for (file of Object.values(req.files)) {
          console.log(file);
          c.put(file.data, `${req.body.id}/${file.name}`, (err) => {
            if (err) throw err;
            c.end();
          });
        }
      });
    });

    c.connect({
      host: "caebes-cp50.wordpresstemporal.com",
      port: 21,
      user: "pasaporte@dea.ong",
      password: "Dislexia123",
    });

    res.send("Todo OK");
  } catch (err) {
    res.json({ message: err });
  }
});

module.exports = router;
