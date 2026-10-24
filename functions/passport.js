const { getPrisma, wrap } = require('../db/prisma');

// Upper bound on numbers skipped in one call (see below); far above any real gap.
const MAX_SKIPS = 10000;

// Atomically returns the next free passport number (starts at 1001). Seeds the counter
// from the current maximum on first use so it never collides with existing records.
// Numbers someone already holds (typed by an admin in modificarSolicitud, or left by the
// old count-based numbering) are skipped, so the counter never hands out an issued number.
// A concurrent admin edit can still take the returned number first; the unique index then
// rejects the write and the route answers 409.
const nextPassporte = async () => {
	const prisma = getPrisma();
	const inc = async () => {
		const rows = await wrap(
			'counters.increment',
			prisma.$queryRaw`UPDATE counters SET seq = seq + 1 WHERE id = 'passport' RETURNING seq`
		);
		return rows.length ? rows[0].seq : null;
	};
	const taken = async numero =>
		Boolean(
			await wrap(
				'usuarios.passportTaken',
				prisma.usuario.findFirst({ where: { numeroPasaporte: numero }, select: { id: true } })
			)
		);

	let seq = await inc();
	if (seq == null) {
		// Not seeded yet: initialize to max(existing, 1000) then increment.
		const highest = await wrap(
			'usuarios.maxPassport',
			prisma.usuario.findFirst({
				where: { numeroPasaporte: { gte: 1000 } },
				orderBy: { numeroPasaporte: 'desc' },
				select: { numeroPasaporte: true },
			})
		);
		const start = Math.max(1000, highest ? highest.numeroPasaporte : 1000);
		await wrap(
			'counters.seed',
			prisma.counter.createMany({ data: [{ id: 'passport', seq: start }], skipDuplicates: true })
		);
		seq = await inc();
	}
	for (let skips = 0; skips < MAX_SKIPS && (await taken(seq)); skips++) seq = await inc();
	return seq;
};

module.exports = { nextPassporte };
