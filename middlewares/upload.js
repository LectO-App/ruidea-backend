const fileUpload = require('express-fileupload');

// Upload limits. The front end checks the same numbers before it sends (src/util/documents.js
// in ruidea-frontend). One upload stays below Cloudflare's 100 MB request limit on the Pages proxy.
const MAX_FILE_MB = 25;
const MAX_UPLOAD_MB = 60;
const MAX_FILES = 10;
const MB = 1024 * 1024;

const FILE_TOO_LARGE = `Un archivo ocupa más de ${MAX_FILE_MB} MB, el máximo por archivo. Si es un PDF escaneado, escanéalo con menos resolución o divídelo en varios PDF.`;
const UPLOAD_TOO_LARGE = `Los archivos ocupan más de ${MAX_UPLOAD_MB} MB en total, el máximo por envío. Quita alguno o escanea los PDF con menos resolución.`;

// Answers before the body is read to the end. The rest of the body is read and dropped, so the
// browser gets the answer instead of a reset connection; the total limit bounds how much.
const tooLarge = (req, res, message) => {
	if (res.headersSent) return;
	req.unpipe();
	req.resume();
	res.status(413).set('Connection', 'close').json({ message });
};

const isMultipart = req => /^multipart\//i.test(req.headers['content-type'] || '');

const checkDeclaredSize = (req, res, next) => {
	if (isMultipart(req) && Number(req.headers['content-length']) > MAX_UPLOAD_MB * MB) {
		return tooLarge(req, res, UPLOAD_TOO_LARGE);
	}
	next();
};

// A body without Content-Length (chunked) is only counted once parsed.
const checkTotalSize = (req, res, next) => {
	const files = Object.values(req.files || {}).flat();
	if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_MB * MB) {
		return res.status(413).json({ message: UPLOAD_TOO_LARGE });
	}
	next();
};

const documentUpload = [
	checkDeclaredSize,
	fileUpload({
		limits: { fileSize: MAX_FILE_MB * MB, files: MAX_FILES },
		limitHandler: (req, res) => tooLarge(req, res, FILE_TOO_LARGE),
	}),
	checkTotalSize,
];

module.exports = { documentUpload, MAX_FILE_MB, MAX_UPLOAD_MB };
