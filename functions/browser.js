const puppeteer = require('puppeteer');
const logger = require('./logger');

// Reuse a single Chromium instead of launching one per request (§6.3). Relaunches
// automatically if it has crashed/disconnected.
let browserPromise = null;

const launch = () =>
	puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
		headless: true,
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
	});

const getBrowser = async () => {
	if (browserPromise) {
		const browser = await browserPromise;
		if (browser.isConnected && browser.isConnected()) return browser;
	}
	browserPromise = launch();
	const browser = await browserPromise;
	browser.on('disconnected', () => {
		browserPromise = null;
	});
	return browser;
};

// Renders a URL to a fresh page with a hard navigation timeout, runs fn(page), and
// always closes the page.
const withPage = async (fn, { timeout = 20000 } = {}) => {
	const browser = await getBrowser();
	const page = await browser.newPage();
	page.setDefaultNavigationTimeout(timeout);
	page.setDefaultTimeout(timeout);
	try {
		return await fn(page);
	} finally {
		await page.close().catch(err => logger.warn({ err }, 'page close failed'));
	}
};

module.exports = { getBrowser, withPage };
