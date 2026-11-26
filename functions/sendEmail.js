const path = require('path');
const nodemailer = require('nodemailer');
const Usuario = require('../models/modeloUsuario');
const { signToken } = require('./tokens');

// Base URL of the frontend that email links point to. Configurable so reset/verify
// links work in any environment (e.g. http://localhost:3000 in dev). Defaults to prod.
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://pasaporte.dea.ong';

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

// Sent with every message and referenced as cid:, so the logo shows without remote-image hosting.
const LOGO = { filename: 'ruidea-logo.png', path: path.join(__dirname, 'email-assets', 'logo-ruidea.png'), cid: 'ruidea-logo' };

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
// (links), or `{ list: [...] }` for a bulleted list; `note` is an optional highlighted
// callout (used for the specialist's message, which is HTML-escaped by the caller).
const emailShell = ({ heading, paragraphs = [], note = null, buttonText, buttonUrl }) => {
	const body = paragraphs
		.map(p =>
			p.list
				? `<ul style="margin:0 0 16px;padding-left:24px;">${p.list
						.map(item => `<li style="margin:0 0 6px;font-family:${FONT};font-size:17px;line-height:1.6;color:${C.ink};">${item}</li>`)
						.join('')}</ul>`
				: `<p style="margin:0 0 16px;font-family:${FONT};font-size:17px;line-height:1.6;color:${C.body};">${p}</p>`
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
					<!-- Accent strip -->
					<tr>
						<td height="4" bgcolor="${C.tealDark}" style="height:4px;background:${C.tealDark};font-size:0;line-height:0;">&nbsp;</td>
					</tr>
					<!-- Header -->
					<tr>
						<td align="left" style="padding:28px 40px 0;">
							<table role="presentation" cellpadding="0" cellspacing="0">
								<tr>
									<td valign="middle" width="40" style="width:40px;">
										<img src="cid:${LOGO.cid}" alt="" width="40" height="40" style="display:block;width:40px;height:40px;border:0;" />
									</td>
									<td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:17px;line-height:1.3;">
										<span style="font-weight:700;color:${C.ink};">RUIDEA</span>&nbsp;<span style="font-weight:500;color:${C.muted};">Pasaporte DEA</span>
									</td>
								</tr>
							</table>
						</td>
					</tr>
					<!-- Body -->
					<tr>
						<td style="padding:28px 40px 8px;">
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
		...paragraphs.map(p => (p.list ? p.list.map(item => `- ${item}`).join('\n') : p.replace(/<[^>]+>/g, ''))),
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
		attachments: [LOGO],
	});
};

// Email-verification message sent right after registration.
// Never sent to an unfinished application (estado 'borrador'): it says a specialist will
// review the application, which is false until POST /inscripcion/:id/enviar. Returns
// whether a message was sent.
const sendEmail = async id => {
	const user = await Usuario.findById(id);
	if (!user || user.estado === 'borrador') return false;
	// 24h window — long enough that people who read email once a day still make it, and it
	// matches the "caduca en 24 horas" wording below. If it lapses, the verify page offers a
	// "Reenviar correo" button that issues a fresh link, so an expired link is never a dead end.
	const emailToken = signToken({ id, purpose: 'email-verify' }, { expiresIn: '24h' });

	await send(user.correoElectronico, 'Confirma tu correo de RUIDEA', {
		heading: 'Confirma tu correo',
		paragraphs: [
			'¡Hola! Gracias por registrarte en RUIDEA.',
			'Solo falta un paso: confirma que este correo es tuyo. En cuanto lo hagas, un especialista revisará tu solicitud y te avisaremos por aquí.',
			'Este enlace caduca en 24 horas. Si ya ha caducado, abre el enlace de todos modos y pulsa «Reenviar correo» para recibir uno nuevo.',
		],
		buttonText: 'Confirmar mi correo',
		buttonUrl: `${FRONTEND_URL}/verificarEmail/${emailToken}`,
	});
	return true;
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

// Password-reset message. The link carries the account's tokenVersion, so it works once:
// setting the password increments it (routes/usuario.js, change-password).
const sendPasswordResetEmail = async (email, id, tokenVersion) => {
	const token = signToken({ id, purpose: 'password-reset', tv: tokenVersion || 0 });

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

const greeting = nombre => (nombre ? `¡Hola, ${escapeHtml(nombre)}!` : '¡Hola!');

// Admin reminder for an unfinished application (estado 'borrador'). `pendientes` are the
// titles of the form steps still missing. The link is the normal login page: the account
// holds medical documents, so the email carries no login token.
const sendDraftReminderEmail = async (user, pendientes) => {
	await send(user.correoElectronico, 'Tu solicitud de RUIDEA aún no está enviada', {
		heading: 'Tu solicitud aún no está enviada',
		paragraphs: [
			`${greeting(user.nombre)} Empezaste tu solicitud del Pasaporte DEA.`,
			'Tu solicitud no está terminada. Todavía no nos la has enviado, así que nadie la puede revisar.',
			'Te falta completar estos pasos:',
			{ list: pendientes.map(escapeHtml) },
			'Entra con tu correo y tu contraseña. Lo que ya escribiste está guardado, y puedes seguir donde lo dejaste.',
			'¿No recuerdas tu contraseña? En la página de entrada, pulsa «Olvidé mi contraseña».',
		],
		buttonText: 'Continuar mi solicitud',
		buttonUrl: `${FRONTEND_URL}/login`,
	});
};

// Sent when an admin cancels (deletes) an unfinished application.
const sendDraftCancelledEmail = async user => {
	await send(user.correoElectronico, 'Hemos cancelado tu solicitud sin terminar de RUIDEA', {
		heading: 'Hemos cancelado tu solicitud sin terminar',
		paragraphs: [
			`${greeting(user.nombre)} Tu solicitud del Pasaporte DEA estaba sin terminar. No se llegó a enviar.`,
			'La hemos cancelado. Borramos los datos que guardaste y los documentos que subiste.',
			'Si quieres tu Pasaporte DEA, puedes empezar de nuevo con el mismo correo.',
		],
		buttonText: 'Empezar de nuevo',
		buttonUrl: `${FRONTEND_URL}/inscribirse`,
	});
};

// Sent when holders delete their own account from "Mis datos" (DELETE /usuario/me).
const sendAccountDeletedEmail = async user => {
	await send(user.correoElectronico, 'Hemos borrado tu cuenta de RUIDEA', {
		heading: 'Hemos borrado tu cuenta',
		paragraphs: [
			`${greeting(user.nombre)} Nos pediste borrar tu cuenta de RUIDEA, y ya está hecho.`,
			'Borramos tus datos y los documentos que subiste. No se pueden recuperar.',
			'Si tenías un Pasaporte DEA, ya no funciona: ni su código QR ni su enlace.',
			'Si quieres un Pasaporte DEA más adelante, puedes volver a solicitarlo con el mismo correo.',
			`Si no fuiste tú, escríbenos a <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.tealDark};font-weight:600;">${SUPPORT_EMAIL}</a>.`,
		],
		buttonText: 'Solicitar un pasaporte',
		buttonUrl: `${FRONTEND_URL}/inscribirse`,
	});
};

module.exports = {
	sendEmail,
	sendEmailAdmin,
	sendPasswordResetEmail,
	sendDraftReminderEmail,
	sendDraftCancelledEmail,
	sendAccountDeletedEmail,
};
