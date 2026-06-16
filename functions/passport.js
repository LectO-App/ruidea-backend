const Counter = require('../models/counter');
const Usuario = require('../models/modeloUsuario');

// Atomically returns the next passport number (starts at 1001). Seeds the counter
// from the current maximum on first use so it never collides with existing records.
const nextPassporte = async () => {
	const inc = async () =>
		Counter.findOneAndUpdate({ _id: 'passport' }, { $inc: { seq: 1 } }, { new: true });

	let counter = await inc();
	if (counter) return counter.seq;

	// Not seeded yet: initialize to max(existing, 1000) then increment.
	const highest = await Usuario.findOne({ numeroPasaporte: { $gte: 1000 } })
		.sort({ numeroPasaporte: -1 })
		.select('numeroPasaporte');
	const start = Math.max(1000, highest ? highest.numeroPasaporte : 1000);
	await Counter.updateOne({ _id: 'passport' }, { $setOnInsert: { seq: start } }, { upsert: true });
	counter = await inc();
	return counter.seq;
};

module.exports = { nextPassporte };
