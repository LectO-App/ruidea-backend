const { test } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.FRONTEND_URL = 'http://localhost:3000';

const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });

const { sendEmailAdmin, sendPassportEmail } = require('../functions/sendEmail');

// Synthetic holder. shareToken is non-enumerable on real records (models/modeloUsuario.js).
const holder = (overrides = {}) => {
	const user = {
		_id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
		nombre: 'Ana <b>',
		apellidos: 'Prueba & Ejemplo',
		numeroDocumento: 'SINT-0001-X',
		fechaNacimiento: '2010-03-04T00:00:00.000Z',
		correoElectronico: 'holder@example.test',
		diagnostico: { dislexia: true, discalculia: false },
		estado: 'aceptado',
		numeroPasaporte: 1042,
		...overrides,
	};
	Object.defineProperty(user, 'shareToken', { value: 'tok_sintetico_123' });
	return user;
};

const last = () => sent[sent.length - 1];

const assertCard = message => {
	assert.match(message.html, /Ana &lt;b&gt; Prueba &amp; Ejemplo/);
	assert.ok(!message.html.includes('Ana <b>'));
	assert.match(message.html, /N\.º 0001042/);
	assert.match(message.html, /<img[^>]+src="cid:pasaporte-qr"[^>]+alt="Código QR de verificación del Pasaporte DEA"/);
	assert.match(message.html, /Si te cuesta explicarlo, enseña o lee esto/);
	assert.match(message.html, /Tengo una dificultad específica del aprendizaje\. Este es mi Pasaporte DEA\./);
	assert.match(message.html, /Si no tienes conexión, enseña este correo\./);

	const qr = message.attachments.find(a => a.cid === 'pasaporte-qr');
	assert.ok(qr, 'QR attached inline');
	assert.equal(qr.contentType, 'image/png');
	assert.equal(qr.content.subarray(1, 4).toString(), 'PNG');
	// Only the logo and the QR: never the passport JPEG or PDF (they carry the ID number and birth date).
	assert.deepEqual(message.attachments.map(a => a.cid).sort(), ['pasaporte-qr', 'ruidea-logo']);

	assert.match(message.text, /Ana <b> Prueba & Ejemplo/);
	assert.match(message.text, /http:\/\/localhost:3000\/verificar\/tok_sintetico_123/);
};

const assertNoPrivateData = message => {
	for (const body of [message.html, message.text]) {
		assert.ok(!body.includes('SINT-0001-X'), 'no ID number');
		assert.ok(!/2010|04\/03|03\/04/.test(body), 'no birth date');
		assert.ok(!/dislexia/i.test(body), 'no diagnosis');
	}
};

test('the aceptado email carries the passport card inline, without the ID number or birth date', async () => {
	await sendEmailAdmin('holder@example.test', 'aceptado', '', holder());
	const message = last();
	assert.equal(message.to, 'holder@example.test');
	assert.match(message.html, /¡Tu Pasaporte DEA está listo!/);
	assertCard(message);
	assertNoPrivateData(message);
});

test('the QR encodes the share link, not the passport or document number', async () => {
	const QRCode = require('qrcode');
	const original = QRCode.toBuffer;
	const urls = [];
	QRCode.toBuffer = async (url, opts) => {
		urls.push(url);
		return original(url, opts);
	};
	try {
		await sendPassportEmail(holder());
	} finally {
		QRCode.toBuffer = original;
	}
	assert.deepEqual(urls, ['http://localhost:3000/verificar/tok_sintetico_123']);
});

test('sendPassportEmail sends the same card to the account address', async () => {
	await sendPassportEmail(holder());
	const message = last();
	assert.equal(message.to, 'holder@example.test');
	assert.equal(message.subject, 'Tu Pasaporte DEA');
	assertCard(message);
	assertNoPrivateData(message);
});

test('revision and rechazado emails have no passport card', async () => {
	await sendEmailAdmin('holder@example.test', 'revision', 'Falta un dato', holder({ estado: 'revision' }));
	assert.ok(!last().html.includes('cid:pasaporte-qr'));
	assert.ok(!last().attachments.some(a => a.cid === 'pasaporte-qr'));
});
