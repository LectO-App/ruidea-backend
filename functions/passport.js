const { getPrisma, wrap } = require('../db/prisma');

// Atomically returns the next passport number (starts at 1001). Seeds the counter
// from the current maximum on first use so it never collides with existing records.
const nextPassporte = async () => {
	const prisma = getPrisma();
	const inc = async () => {
		const rows = await wrap(
			'counters.increment',
			prisma.$queryRaw`UPDATE counters SET seq = seq + 1 WHERE id = 'passport' RETURNING seq`
		);
		return rows.length ? rows[0].seq : null;
	};

	const seq = await inc();
	if (seq != null) return seq;

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
	return inc();
};

module.exports = { nextPassporte };
