const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const puppeteer = require('puppeteer');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/modeloUsuario');
const auth = require('../middlewares/request-auth');

const { sendPasswordResetEmail } = require('../functions/sendEmail');

router.post('/verificar/:numeroDocumento/:numeroPasaporte', auth, async (req, res) => {
	const usuarioSolicitado = await Usuario.findOne({
		numeroPasaporte: req.params.numeroPasaporte,
	});
	if (usuarioSolicitado == null || usuarioSolicitado.numeroDocumento != req.params.numeroDocumento)
		return res.json({ existe: false });
	res.json({ existe: true, usuario: usuarioSolicitado });
});

router.get('/estado/:id', auth, async (req, res) => {
	const usuarioSolicitado = await Usuario.findOne({ _id: req.params.id });

	res.json(usuarioSolicitado);
});

// pasar JSON del estilo:
// {
//     "user": mail o numero de pasaporte
//     "password": contraseña
// }
router.post('/login', auth, async (req, res) => {
	try {
		// Busco el usuario
		if (!isNaN(req.body.user)) var usuario = await Usuario.findOne({ numeroPasaporte: req.body.user });
		else var usuario = await Usuario.findOne({ correoElectronico: req.body.user });
		if (usuario == null) return res.status(401).json({ correcto: false });

		// Verifico la contraseña
		if (await bcrypt.compare(req.body.password, usuario.password)) {
			res.json({ correcto: true, usuario: usuario });
		} else {
			res.status(401).json({ correcto: false });
		}
	} catch (err) {
		res.status(401).json({ message: err });
	}
});

// Ignorar
router.get('/count', auth, async (req, res) => {
	try {
		const cant = await Usuario.countDocuments();
		res.json({ cant: cant });
	} catch (err) {
		res.json({ message: err });
	}
});

router.get('/descargar/:type/:id', auth, async (req, res) => {
	const user = await Usuario.findById(req.params.id);
	const browser = await puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});
	const page = await browser.newPage();

	const string = new Date(Date.parse(user.fechaNacimiento)).toISOString().split('-');

	const dateString = `${string[2].split('T')[0]}/${string[1]}/${string[0]}`;

	await page.goto(
		`https://ruidea-template.netlify.app/?apellidos=${user.apellidos}&nombre=${user.nombre}&fechaNacimiento=${dateString}&pais=${user.paisResidencia}&numeroDocumento=${user.numeroDocumento}&numeroPasaporte=${user.numeroPasaporte}`,
		{ waitUntil: 'networkidle2' }
	);

	let buffer;
	if (req.params.type === 'pdf') {
		buffer = await page.pdf({
			width: '1000',
			height: '589',
			printBackground: true,
			encoding: 'base64',
			pageRanges: '1',
		});
		await browser.close();

		res.set({
			'Content-Type': 'application/pdf',
			'Content-Length': buffer.length,
		});
		res.send(buffer);
	} else if (req.params.type === 'img') {
		await page.setViewport({ width: 1000, height: 590, deviceScaleFactor: 2 });
		buffer = await page.screenshot({
			type: 'jpeg',
			quality: 100,
		});

		await browser.close();

		res.set({
			'Content-Type': 'image/jpeg',
			'Content-Length': buffer.length,
		});
		res.send(buffer);
	}
});

router.post('/forgot-password', async (req, res) => {
	try {
		const email = req.body.email;
		const user = await Usuario.findOne({ correoElectronico: email });
		await sendPasswordResetEmail(email, user._id);

		res.send('Email de cambio de contraseña enviado!');
	} catch (err) {
		res.status(500).json({ message: 'Hubo un error al enviar el email', err });
	}
});

router.post('/change-password', async (req, res) => {
	try {
		const { token, password } = req.body;
		const { id } = jwt.verify(token, process.env.SECURITY_KEY);

		const hashedNewPassword = await bcrypt.hash(password, 10);

		const newUser = await Usuario.findById(id);
		const oldPass = newUser.password;

		newUser.password = hashedNewPassword;
		await newUser.save();

		res.send({ newUser, oldPass });
	} catch (err) {
		res.status(500).json({ err });
	}
});

router.delete('/:id', async (req, res) => {
	const user = await Usuario.findByIdAndDelete(req.params.id);
	res.json({ message: 'Eliminado!', user });
});

module.exports = router;
