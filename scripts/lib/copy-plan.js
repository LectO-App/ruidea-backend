// Pure planning helpers for scripts/mongo-to-postgres.js (no I/O; unit-tested in
// test/copy-plan.test.js). They take usuario rows in MongoDB insertion order.

const ISSUED = 1000;

// Duplicate issued passport numbers. Within each group one holder keeps the number and
// every other holder gets a new one from the passport counter, skipping numbers already in
// use, so nobody is left without a passport number.
//
// Who keeps it: when the number was assigned isn't stored, so the number stays with the
// holder the verify page resolves it to today: accepted holders first (the verify page
// and the verifier lookup only match estado 'aceptado'), then MongoDB insertion order
// (which is also creation order for records the app created). No passport that verifies
// today stops verifying.
//
// counterSeq is the current value of the 'passport' counter (null when there is none; the
// app then seeds it from the highest issued number, and so does this plan).
const planPassports = (rows, counterSeq) => {
	const groups = new Map();
	const taken = new Set();
	rows.forEach((row, index) => {
		const n = row.numeroPasaporte;
		if (!(Number.isInteger(n) && n >= ISSUED)) return;
		taken.add(n);
		if (!groups.has(n)) groups.set(n, []);
		groups.get(n).push({ row, index });
	});

	let seq = counterSeq != null ? counterSeq : Math.max(ISSUED, ...taken);
	const out = [];
	const duplicated = [...groups].filter(([, members]) => members.length > 1).sort((a, b) => a[0] - b[0]);
	for (const [numero, members] of duplicated) {
		const ordered = members
			.slice()
			.sort((a, b) => (b.row.estado === 'aceptado') - (a.row.estado === 'aceptado') || a.index - b.index);
		const [keeper, ...later] = ordered;
		const reassigned = later.map(({ row }) => {
			do {
				seq += 1;
			} while (taken.has(seq));
			taken.add(seq);
			return { id: row.id, from: numero, to: seq };
		});
		out.push({ numero, keptBy: keeper.row.id, reassigned });
	}
	return { groups: out, counterSeq: seq };
};

module.exports = { planPassports };
