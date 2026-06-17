const nodemailer = require('nodemailer');
const Usuario = require('../models/modeloUsuario');
const { signToken } = require('./tokens');

// Base URL of the frontend that email links point to. Configurable so reset/verify
// links work in any environment (e.g. http://localhost:3000 in dev). Defaults to prod.
const FRONTEND_URL = process.env.FRONTEND_URL || '${FRONTEND_URL}';

const SUPPORT_EMAIL = 'pasaporte@dea.ong';
const FROM = '"RUIDEA" pasaporte@dea.ong';

// Brand palette — kept in sync with the frontend design tokens (variables.scss) so the
// emails feel like the same product as the redesigned app.
const C = {
	bg: '#faf7f2', // warm off-white
	surface: '#ffffff',
	ink: '#2b2b33', // soft black — easier to read than pure black
	body: '#4a4a52',
	muted: '#7a7c83',
	teal: '#41a1ac',
	tealDark: '#297f89',
	border: '#e4e0d8',
	noteBg: '#eef6f7',
};
// System font stack — sans-serif, no webfont round-trip; clean and dyslexia-friendly.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const transporter = () =>
	nodemailer.createTransport({
		host: 'smtp.office365.com',
		port: 587,
		secure: false,
		auth: {
			user: 'pasaporte@dea.ong',
			pass: process.env.SMTP_KEY,
		},
	});

// HTML-escape free text before interpolating into email HTML (§5.3).
const escapeHtml = str =>
	String(str == null ? '' : str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');

// A bulletproof CTA button: VML fallback for Outlook, a real <a> everywhere else.
const button = (text, url) => `
	<!--[if mso]>
	<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:300px;" arcsize="20%" stroke="f" fillcolor="${C.teal}">
	<w:anchorlock/>
	<center style="color:#ffffff;font-family:${FONT};font-size:16px;font-weight:bold;">${text}</center>
	</v:roundrect>
	<![endif]-->
	<!--[if !mso]><!-->
	<a href="${url}" target="_blank" style="display:inline-block;background:${C.teal};color:#ffffff;font-family:${FONT};font-size:16px;font-weight:700;line-height:50px;text-align:center;text-decoration:none;width:300px;max-width:80%;border-radius:12px;">${text}</a>
	<!--<![endif]-->`;

// One shared template for every email. `paragraphs` may contain safe author-written HTML
// (links); `note` is an optional highlighted callout (used for the specialist's message,
// which is HTML-escaped by the caller).
const emailShell = ({ heading, paragraphs = [], note = null, buttonText, buttonUrl }) => {
	const body = paragraphs
		.map(
			p =>
				`<p style="margin:0 0 16px;font-family:${FONT};font-size:17px;line-height:1.6;color:${C.body};">${p}</p>`
		)
		.join('');

	const noteHtml = note
		? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-collapse:separate;">
				<tr>
					<td style="background:${C.noteBg};border-left:4px solid ${C.teal};border-radius:10px;padding:16px 18px;">
						<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${C.tealDark};">${note.label}</p>
						<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.ink};font-style:italic;">${note.text}</p>
					</td>
				</tr>
			</table>`
		: '';

	return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta http-equiv="X-UA-Compatible" content="IE=edge" />
	<title>RUIDEA</title>
	<!--[if mso]><style>* { font-family: Arial, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
		<tr>
			<td align="center" style="padding:32px 16px;">
				<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:${C.surface};border:1px solid ${C.border};border-radius:18px;overflow:hidden;">
					<!-- Header / wordmark -->
					<tr>
						<td align="center" style="padding:30px 24px 22px;border-bottom:1px solid ${C.border};">
							<span style="font-family:${FONT};font-size:21px;font-weight:800;letter-spacing:0.05em;color:${C.tealDark};">RUIDEA</span><span style="font-family:${FONT};font-size:13px;font-weight:600;letter-spacing:0.01em;color:${C.muted};"> &middot; Pasaporte DEA</span>
						</td>
					</tr>
					<!-- Body -->
					<tr>
						<td style="padding:30px 40px 8px;">
							<h1 style="margin:0 0 16px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:800;color:${C.ink};">${heading}</h1>
							${body}
							${noteHtml}
						</td>
					</tr>
					<!-- CTA -->
					<tr>
						<td align="center" style="padding:8px 40px 36px;">
							${button(buttonText, buttonUrl)}
						</td>
					</tr>
					<!-- Footer -->
					<tr>
						<td style="padding:22px 40px;background:${C.bg};border-top:1px solid ${C.border};">
							<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};text-align:center;">
								Sistema creado por el equipo de LectO, en colaboración con Disfam.
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
};

// Plaintext fallback so the message is still readable where HTML is stripped.
const plain = ({ heading, paragraphs = [], note = null, buttonText, buttonUrl }) =>
	[
		heading,
		'',
		...paragraphs.map(p => p.replace(/<[^>]+>/g, '')),
		note ? `\n${note.label}: ${note.text}` : '',
		'',
		`${buttonText}: ${buttonUrl}`,
		'',
		'Sistema creado por el equipo de LectO, en colaboración con Disfam.',
	]
		.filter(line => line !== null && line !== undefined)
		.join('\n');

const send = async (to, subject, content) => {
	await transporter().sendMail({
		from: FROM,
		to,
		subject,
		text: plain(content),
		html: emailShell(content),
	});
};

// Email-verification message sent right after registration.
const sendEmail = async id => {
	const user = await Usuario.findById(id);
	const emailToken = signToken({ id, purpose: 'email-verify' });

	await send(user.correoElectronico, 'Confirma tu correo de RUIDEA', {
		heading: 'Confirma tu correo',
		paragraphs: [
			'¡Hola! Gracias por registrarte en RUIDEA.',
			'Solo falta un paso: confirma que este correo es tuyo. En cuanto lo hagas, un especialista revisará tu solicitud y te avisaremos por aquí.',
		],
		buttonText: 'Confirmar mi correo',
		buttonUrl: `${FRONTEND_URL}/verificarEmail/${emailToken}`,
	});
};

// Status-change messages sent by the admin review flow.
const sendEmailAdmin = async (email, estado, mensajeMedico = '') => {
	const dashboardUrl = `${FRONTEND_URL}/dashboard`;
	const note = mensajeMedico ? { label: 'Mensaje del especialista', text: escapeHtml(mensajeMedico) } : null;

	let content;
	switch (estado) {
		case 'aceptado':
			content = {
				heading: '¡Tu Pasaporte DEA está listo!',
				paragraphs: [
					'Un especialista revisó tu solicitud y la aprobó.',
					'Entra a tu panel para descargar tu pasaporte en PDF o JPG, o copiar el enlace para compartirlo cuando lo necesites.',
				],
				buttonText: 'Ver mi pasaporte',
				buttonUrl: dashboardUrl,
			};
			break;
		case 'revision':
			content = {
				heading: 'Necesitamos que revises un detalle',
				paragraphs: [
					'Un especialista revisó tu solicitud y dejó un mensaje para ti. Con un pequeño cambio quedará lista.',
					'Entra a tu panel para corregir lo necesario y volver a enviarla.',
				],
				note,
				buttonText: 'Revisar mi solicitud',
				buttonUrl: dashboardUrl,
			};
			break;
		case 'rechazado':
			content = {
				heading: 'Novedades sobre tu solicitud',
				paragraphs: [
					'Lo sentimos. Un especialista revisó tu solicitud y no pudo aprobarla esta vez.',
					`Si crees que se trata de un error, escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.tealDark};font-weight:600;">${SUPPORT_EMAIL}</a> y lo vemos contigo.`,
				],
				note,
				buttonText: 'Ver mi solicitud',
				buttonUrl: dashboardUrl,
			};
			break;
		default:
			return;
	}

	await send(email, 'Novedades sobre tu solicitud de RUIDEA', content);
};

// Password-reset message.
const sendPasswordResetEmail = async (email, id) => {
	const token = signToken({ id, purpose: 'password-reset' });

	await send(email, 'Cambia tu contraseña de RUIDEA', {
		heading: 'Cambia tu contraseña',
		paragraphs: [
			'Recibimos una solicitud para cambiar tu contraseña de RUIDEA.',
			'Si no fuiste tú, puedes ignorar este correo sin problema. Para crear una nueva, usa el botón de abajo.',
		],
		buttonText: 'Cambiar mi contraseña',
		buttonUrl: `${FRONTEND_URL}/cambiarContraseña/${token}`,
	});
};

module.exports = { sendEmail, sendEmailAdmin, sendPasswordResetEmail };
