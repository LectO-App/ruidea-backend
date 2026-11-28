// The review queue: pending applications, the one that has waited longest first. An
// application waits from when it was sent (fechaEnvio); records sent before fechaEnvio
// existed wait from fechaCreacion. Records with neither date go last.
const waitingSince = u => {
	const at = Date.parse(u.fechaEnvio || u.fechaCreacion);
	return Number.isNaN(at) ? Infinity : at;
};

// Stable, so ties keep the database order.
const oldestFirst = list => [...list].sort((a, b) => {
	const wa = waitingSince(a);
	const wb = waitingSince(b);
	return wa === wb ? 0 : wa < wb ? -1 : 1;
});

module.exports = { oldestFirst };
