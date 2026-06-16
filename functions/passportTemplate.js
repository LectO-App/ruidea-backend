const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

// First-party, self-contained passport renderer — a faithful in-project copy of the old
// externally-hosted ruidea-template, so no identity data is ever sent to a third party
// (SECURITY_ASSESSMENT.md §2.3/§13). Assets are inlined as data URIs and the QR is
// generated server-side, so the HTML needs no external fetches (except the webfont).

const ASSETS = path.join(__dirname, 'passport-assets');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://pasaporte.dea.ong';

const escapeHtml = str =>
	String(str == null ? '' : str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');

// Cache encoded assets in memory (they never change at runtime).
const cache = new Map();
const dataUri = (relPath, mime) => {
	if (cache.has(relPath)) return cache.get(relPath);
	try {
		const buf = fs.readFileSync(path.join(ASSETS, relPath));
		const uri = `data:${mime};base64,${buf.toString('base64')}`;
		cache.set(relPath, uri);
		return uri;
	} catch (err) {
		return ''; // missing asset (e.g. unknown country flag) -> render without it
	}
};

// Raw SVG markup (for inlining into the DOM rather than via <img>). An SVG used as an
// <img> renders in an isolated document that can't see the page's @font-face, so its
// <text> fell back to a system serif; inlined, it inherits the page's "Muli" font.
const rawSvg = relPath => {
	const key = `raw:${relPath}`;
	if (cache.has(key)) return cache.get(key);
	let svg = '';
	try {
		svg = fs.readFileSync(path.join(ASSETS, relPath), 'utf8');
	} catch (err) {
		svg = '';
	}
	cache.set(key, svg);
	return svg;
};

const formatDate = value => {
	const d = new Date(value);
	if (isNaN(d.getTime())) return '';
	const pad = n => String(n).padStart(2, '0');
	return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

const formatPassport = num => String(num == null ? '' : num).padStart(7, '0');

// Self-hosted Muli (now "Mulish") font, inlined as @font-face data URIs so rendering
// makes no external font request — fully offline/first-party. Built once at load.
const fontFaceCss = [400, 600, 700]
	.map(weight => {
		try {
			const file = require.resolve(`@fontsource/mulish/files/mulish-latin-${weight}-normal.woff2`);
			const b64 = fs.readFileSync(file).toString('base64');
			return `@font-face{font-family:'Muli';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
		} catch (err) {
			return '';
		}
	})
	.join('');

const passportHtml = async user => {
	const pais = user.paisResidencia || '';
	const flagUri = pais ? dataUri(`flags/${pais.toLowerCase()}.svg`, 'image/svg+xml') : '';
	// Inlined (not an <img>) so the SVG's font-family:Muli text resolves against the page's
	// inlined @font-face instead of rendering in a serif fallback.
	const logoRuidea = rawSvg('recurso2.svg').replace('<svg', '<svg class="logo-ruidea"');
	const logoDisfam = dataUri('logo-disfam.webp', 'image/webp');
	const logoLecto = dataUri('logo-lecto.webp', 'image/webp');

	const verifyUrl = `${FRONTEND_URL}/verificar/${encodeURIComponent(user.numeroDocumento)}/${encodeURIComponent(
		user.numeroPasaporte
	)}`;
	let qrUri = '';
	try {
		qrUri = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 180 });
	} catch (err) {
		/* QR optional */
	}

	return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <style>
      ${fontFaceCss}
      * { margin: 0; padding: 0; box-sizing: border-box; font-family: "Muli", sans-serif; }
      body { overflow-x: hidden; width: 1000px !important; height: 590px !important; position: relative; display: flex; flex-direction: column; }
      .container-topbar { background: #41a1ac; width: 100%; padding: 40px 0; display: flex; justify-content: center; align-items: center; color: #fff; }
      .container-topbar h1 { font-size: 40px; }
      .logo-disfam { display: flex; justify-content: center; align-items: center; position: absolute; right: 40px; height: 50px; }
      .pais { display: flex; justify-content: center; align-items: center; position: absolute; left: 40px; }
      .pais img { width: 79.39px; height: 53.29px; margin-right: 15px; }
      .pais p { font-size: 28.82px; }
      .disfam { display: flex; justify-content: center; align-items: center; position: absolute; right: 19px; }
      .disfam img { width: auto !important; height: 80px; padding: 10px; margin: 0; background: #fff; border-radius: 50%; }
      main { display: flex; align-items: center; flex-direction: column; flex: 1; padding: 0 40px; position: relative; }
      .flex { height: 100%; width: 100%; display: flex; justify-content: center; align-items: center; flex: 1; }
      .container-imagen { display: flex; align-items: center; width: 325px; }
      .logo-ruidea { width: 80%; height: auto; }
      main .container-info { flex: 1; display: flex; justify-content: space-around; height: 80%; flex-direction: column; }
      .nombre, .apellidos { font-size: 54px; color: #161616; }
      .fecha-nacimiento { font-size: 40px; color: #3e3e3e; }
      .numero-dni { font-weight: bold; font-size: 40px; color: #282828; }
      .container-qr { position: absolute; bottom: 10px; right: 10px; width: 180px; }
      .container-qr #qr > img, canvas { width: 80%; display: block; margin: 10px auto; }
      .desarrollado-lecto { width: 100%; text-align: center; font-size: 14px; position: relative; }
      .desarrollado-lecto img { width: 59.82px; height: 22.29px; }
      .nro-pasaporte { align-self: flex-start; font-size: 35px; font-weight: 600; font-size: 35.0597px; line-height: 52px; color: #151515; }
      footer { height: 70px; display: flex; justify-content: center; align-items: center; background: #41a1ac; text-align: center; }
      footer p { color: #fff; width: 70%; line-height: 1.4; }
    </style>
  </head>
  <body>
    <div class="container-topbar">
      <div class="pais">
        ${flagUri ? `<img src="${flagUri}" class="bandera-pais" />` : ''}
        <p>${escapeHtml(pais)}</p>
      </div>
      <h1>PASAPORTE DEA</h1>
      <div class="pais disfam">
        <img src="${logoDisfam}" alt="" class="logo-disfam" />
      </div>
    </div>

    <main>
      <div class="flex">
        <div class="container-imagen">
          ${logoRuidea}
        </div>
        <div class="container-info">
          <div>
            <h1 class="apellidos">${escapeHtml(user.apellidos)}</h1>
            <h1 class="nombre">${escapeHtml(user.nombre)}</h1>
          </div>
          <p class="fecha-nacimiento">${escapeHtml(formatDate(user.fechaNacimiento))}</p>
          <h2 class="numero-dni">${escapeHtml(user.numeroDocumento)}</h2>
        </div>
      </div>
      <div class="nro-pasaporte">Pasaporte N° <span>${escapeHtml(formatPassport(user.numeroPasaporte))}</span></div>

      <div class="container-qr">
        <div id="qr">${qrUri ? `<img src="${qrUri}" alt="QR" />` : ''}</div>
        <p class="desarrollado-lecto">
          Sistema desarrollado por el equipo de
          <img src="${logoLecto}" alt="" />
        </p>
      </div>
    </main>
    <footer>
      <p>
        Rogamos tengan en consideración las circunstancias que concurren en la persona portadora de este documento, así como los derechos recogidos en la legislación vigente
      </p>
    </footer>
  </body>
</html>`;
};

module.exports = { passportHtml };
