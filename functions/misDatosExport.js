const JSZip = require('jszip');
const browser = require('./browser');
const blob = require('./blob');
const { escapeHtml, fontFaceCss } = require('./passportTemplate');

// "Descargar mis datos" (GET /usuario/me/export): a ZIP built in memory for one request and
// never written anywhere. It holds a readable PDF of every stored field in plain Spanish,
// datos.json with the record as the API stores it, and the holder's uploaded documents.

const VISIBILIDAD = {
	enlace: 'Lo ve quien abre tu enlace o tu código QR.',
	equipo: 'Lo ven solo las personas de RUIDEA que revisan las solicitudes.',
};

const fechaLarga = d => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const datosHtml = ({ grupos, enlace, generado }) => `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <style>
      ${fontFaceCss}
      * { margin: 0; padding: 0; box-sizing: border-box; font-family: "Muli", sans-serif; }
      body { background: #faf7f2; color: #2b2b33; font-size: 15px; line-height: 1.6; padding: 36px 44px; }
      h1 { font-size: 28px; margin-bottom: 6px; }
      .lead { color: #5f6168; margin-bottom: 18px; }
      .leyenda { background: #fff; border: 1px solid #e4e0d8; border-radius: 12px; padding: 12px 16px; margin-bottom: 18px; }
      .leyenda p { margin: 2px 0; }
      section { background: #fff; border: 1px solid #e4e0d8; border-radius: 12px; padding: 14px 18px; margin-bottom: 12px; break-inside: avoid; }
      h2 { font-size: 17px; display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .chip { font-size: 12px; font-weight: 600; border-radius: 99px; padding: 2px 10px; }
      .chip-enlace { background: #fdf1c7; color: #6b5200; }
      .chip-equipo { background: #d7f1f4; color: #1f6b73; }
      dl { display: grid; grid-template-columns: 220px 1fr; gap: 4px 14px; }
      dt { color: #5f6168; }
      dd { font-weight: 600; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <h1>Mis datos en RUIDEA</h1>
    <p class="lead">Esto es todo lo que guardamos sobre ti. Copia preparada el ${escapeHtml(fechaLarga(generado))}.</p>
    <div class="leyenda">
      <p><span class="chip chip-enlace">en tu enlace</span> ${VISIBILIDAD.enlace}</p>
      <p><span class="chip chip-equipo">solo el equipo</span> ${VISIBILIDAD.equipo}</p>
    </div>
    ${grupos
			.map(
				g => `<section>
      <h2>${escapeHtml(g.titulo)} <span class="chip chip-${g.visibilidad}">${g.visibilidad === 'enlace' ? 'en tu enlace' : 'solo el equipo'}</span></h2>
      <dl>${g.campos.map(c => `<dt>${escapeHtml(c.etiqueta)}</dt><dd>${escapeHtml(c.valor)}</dd>`).join('')}</dl>
    </section>`
			)
			.join('\n    ')}
    ${
			enlace
				? `<section>
      <h2>Tu enlace</h2>
      <p>${
				enlace.veces === 0
					? 'Nadie lo abrió en los últimos 30 días.'
					: `Lo abrieron ${enlace.veces} ${enlace.veces === 1 ? 'vez' : 'veces'} en los últimos 30 días: ${escapeHtml(
							enlace.dias.map(d => fechaLarga(new Date(`${d}T00:00:00Z`))).join(', ')
					  )}.`
			}</p>
    </section>`
				: ''
		}
  </body>
</html>`;

const renderPdf = async html => {
	const buf = await browser.withPage(async page => {
		await page.setContent(html, { waitUntil: 'networkidle0' });
		await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
		return page.pdf({ format: 'A4', printBackground: true });
	});
	return Buffer.from(buf);
};

const extension = name => (/\.[a-z0-9]{1,5}$/i.exec(name) || ['.bin'])[0].toLowerCase();

// Every stored upload of the holder: the blobs under "<id>/" plus `archivoBlob` when it lives
// outside that folder (older naming). A storage error rejects, so a copy never silently lacks
// documents.
const userDocuments = async (id, archivoBlob) => {
	const names = await blob.listBlobs(`${id}/`);
	if (archivoBlob && !names.includes(archivoBlob)) names.push(archivoBlob);
	return Promise.all(
		names.map(async (name, i) => ({ name: `documentos/documento-${i + 1}${extension(name)}`, data: await blob.downloadBlob(name) }))
	);
};

// usuario: the holder's record (models/modeloUsuario); grupos: fieldGroups(usuario);
// enlace: linkOpenings(...) or null.
const buildExport = async ({ usuario, grupos, enlace, generado = new Date() }) => {
	const [pdf, documentos] = await Promise.all([
		renderPdf(datosHtml({ grupos, enlace, generado })),
		userDocuments(String(usuario._id), usuario.archivoBlob),
	]);
	const zip = new JSZip();
	zip.file('mis-datos.pdf', pdf);
	zip.file(
		'datos.json',
		JSON.stringify(
			{ generado: generado.toISOString(), usuario: usuario.toJSON(), enlace, documentos: documentos.map(d => d.name) },
			null,
			2
		)
	);
	for (const doc of documentos) zip.file(doc.name, doc.data);
	return zip;
};

module.exports = { buildExport, datosHtml };
