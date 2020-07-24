const express = require('express');
const app = express();
const mongoose = require('mongoose');
const cors = require('cors');
const mongodb = require('mongodb');
const bodyParser = require('body-parser');

require('dotenv/config');

app.use(express.json());

// Import routes
const inscripcionRoutes = require('./routes/inscripcion');
const adminRoutes = require('./routes/admin');
const usuarioRoutes = require('./routes/usuario');

// MIDDLEWAREs
app.use(cors());
app.use('/admin', adminRoutes);
app.use('/inscripcion', inscripcionRoutes);
app.use('/usuario', usuarioRoutes);

// ROUTES
app.get('/', (req, res) => {
    res.send('We are on home');
});

// Connecting to data-base
mongoose.connect(process.env.DB_CONNECTION, { useNewUrlParser: true, useUnifiedTopology: true },
    () => { console.log("Conncected to DB"); }
);

app.listen(3000);