const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
delete process.env.FRONTEND_URL;

const sent = [];
require('nodemailer').createTransport = () => ({ sendMail: async message => sent.push(message) });
require('../models/modeloUsuario').findById = async id => ({ id, correoElectronico: 'someone@example.test' });

const { sendEmail, sendEmailAdmin, sendPasswordResetEmail } = require('../functions/sendEmail');

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const sendAll = async () => {
	sent.length = 0;
	await sendEmail(ID);
	await sendEmailAdmin('someone@example.test', 'aceptado');
	await sendEmailAdmin('someone@example.test', 'revision', 'Falta un dato');
	await sendEmailAdmin('someone@example.test', 'rechazado', 'No aplica');
	await sendPasswordResetEmail('someone@example.test', ID, 0);
	return sent;
};

test('every email embeds the RUIDEA logo as an inline cid attachment', async () => {
	for (const message of await sendAll()) {
		const logo = message.attachments.find(a => a.cid === 'ruidea-logo');
		assert.ok(logo, message.subject);
		assert.match(fs.readFileSync(logo.path).subarray(1, 4).toString(), /PNG/);
		// Decorative: the name is written beside it, so blocked images do not repeat it.
		assert.match(message.html, /<img[^>]+src="cid:ruidea-logo"[^>]+alt=""/);
	}
});

test('the header still reads RUIDEA and Pasaporte DEA as text when images are blocked', async () => {
	const [message] = await sendAll();
	const header = /<!-- Header -->([\s\S]*?)<!-- Body -->/.exec(message.html)[1];
	const text = header.replace(/<img[^>]*>/g, '').replace(/<[^>]+>/g, ' ');
	assert.match(text, /RUIDEA/);
	assert.match(text, /Pasaporte DEA/);
	assert.strictEqual(header.match(/RUIDEA/g).length, 1, 'the name appears once in the header');
});

test('links fall back to the production front end when FRONTEND_URL is unset', async () => {
	const messages = await sendAll();
	assert.ok(messages.every(m => m.html.includes('href="https://pasaporte.dea.ong/')));
	assert.ok(messages.every(m => !m.html.includes('${FRONTEND_URL}')));
});
