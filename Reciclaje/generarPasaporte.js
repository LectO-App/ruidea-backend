const numeroPasaporte = require('./models/modeloNumeroPasaporte');
const mongoose = require('mongoose');
require('dotenv/config');

// Connecting to data-base
mongoose.connect(process.env.DB_CONNECTION, { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true },
    () => { console.log("Conncected to DB"); }
);

const generar = async() => {

    console.log(numeroPasaporte);
    const user = { numeroActual: 0, identificador: "id" }
    const newUser = await numeroPasaporte(user);
    const savedUser = await newUser.save();
    console.log(savedUser);
}

generar();