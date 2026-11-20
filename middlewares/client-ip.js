const net = require('node:net');

// The site reaches this API through the Cloudflare Pages Function in ruidea-frontend
// (functions/api/[[path]].js). Every such request arrives from a Cloudflare egress address,
// so with `trust proxy` 1 req.ip is shared by many visitors and the per-IP rate limits and
// audit IPs are per Cloudflare node, not per person.
//
// Cloudflare sets CF-Worker to the zone of the Worker that made the subrequest (here
// ruidea.pages.dev) and CF-Connecting-IP to the visitor; neither can be set by the visitor or
// by another Worker. So when CF-Worker names our Pages project, req.ip becomes
// CF-Connecting-IP. This is only safe because the Container App's ingress accepts Cloudflare's
// ranges (plus the environment's own outbound IP) and nothing else: a direct request with
// forged headers never reaches the app.
//
// PAGES_PROXY_WORKER overrides the expected CF-Worker value; set it empty to turn this off.
const pagesProxyWorker = () => process.env.PAGES_PROXY_WORKER ?? 'ruidea.pages.dev';

const fromPagesProxy = req => {
	const worker = pagesProxyWorker();
	return Boolean(worker) && req.get('cf-worker') === worker;
};

// The Pages Function sets X-Visitor-Country from request.cf.country (ISO 3166-1 alpha-2, or
// Cloudflare's XX for unknown and T1 for Tor). Trusted only under the same rule as the IP.
const visitorCountry = req => {
	if (!fromPagesProxy(req)) return null;
	const country = String(req.get('x-visitor-country') || '').trim().toUpperCase();
	return /^[A-Z][A-Z0-9]$/.test(country) && country !== 'XX' ? country : null;
};

function clientIp(req, _res, next) {
	if (fromPagesProxy(req)) {
		const ip = String(req.get('cf-connecting-ip') || '').trim();
		if (net.isIP(ip)) {
			Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
		}
	}
	next();
}

module.exports = { clientIp, visitorCountry };
