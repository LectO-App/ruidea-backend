const rateLimit = require('express-rate-limit');

const generic = { standardHeaders: true, legacyHeaders: false };

// Tight limiter for unauthenticated, abusable endpoints: outbound-email triggers
// (forgot-password, resend) and credential checks. Curbs spam relay / SMTP-reputation
// burn / brute force (SECURITY_ASSESSMENT.md §4.2, §11.2).
const emailLimiter = rateLimit({
	...generic,
	windowMs: 60 * 60 * 1000, // 1 hour
	max: 5,
	message: { message: 'Demasiadas solicitudes. Intente nuevamente más tarde.' },
});

const authLimiter = rateLimit({
	...generic,
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 20,
	message: { message: 'Demasiados intentos. Intente nuevamente más tarde.' },
});

// Account/draft creation: unauthenticated and writes a record + triggers a session.
// Looser than the email limiter (legitimate retries happen) but blocks bulk signup abuse.
const registerLimiter = rateLimit({
	...generic,
	windowMs: 60 * 60 * 1000, // 1 hour
	max: 15,
	message: { message: 'Demasiados registros desde esta red. Intente nuevamente más tarde.' },
});

// Passport verification / lookup endpoints — enumeration-prone (§4.2, §1.8).
const verifyLimiter = rateLimit({
	...generic,
	windowMs: 15 * 60 * 1000,
	max: 60,
	message: { message: 'Demasiadas verificaciones. Intente nuevamente más tarde.' },
});

module.exports = { emailLimiter, authLimiter, verifyLimiter, registerLimiter };
