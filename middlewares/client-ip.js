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

function clientIp(req, _res, next) {
	const worker = pagesProxyWorker();
	if (worker && req.get('cf-worker') === worker) {
		const ip = String(req.get('cf-connecting-ip') || '').trim();
		if (net.isIP(ip)) {
			Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
		}
	}
	next();
}

module.exports = { clientIp };
