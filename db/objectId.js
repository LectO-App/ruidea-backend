const crypto = require('crypto');

// Record ids stay MongoDB ObjectId strings (24 lowercase hex) after the move to Postgres:
// existing ids are copied as-is, and new rows get an id generated the same way MongoDB
// did (4-byte timestamp, 5 random bytes, 3-byte counter). URLs, session tokens and email
// links that carry an id keep working, and ids still sort roughly by creation time.

const HEX24 = /^[0-9a-fA-F]{24}$/;

const processUnique = crypto.randomBytes(5);
let counter = crypto.randomInt(0xffffff);

const newObjectId = () => {
	const buf = Buffer.alloc(12);
	buf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
	processUnique.copy(buf, 4);
	counter = (counter + 1) % 0xffffff;
	buf.writeUIntBE(counter, 9, 3);
	return buf.toString('hex');
};

// Same answer as mongoose.isValidObjectId() for the values the routes pass (strings from
// URLs and tokens): a 24-character hex string, either case.
const isValidObjectId = id => typeof id === 'string' && HEX24.test(id);

// Mongoose threw a CastError when a lookup id could not be cast to an ObjectId, and several
// routes rely on that to answer 400/500 instead of 404. Keep the same behaviour: null and
// undefined mean "no id" (no match), anything else must be a valid id.
class CastError extends Error {
	constructor() {
		super('Cast to ObjectId failed');
		this.name = 'CastError';
	}
}

const castObjectId = id => {
	if (id == null) return null;
	if (!isValidObjectId(id)) throw new CastError();
	return id.toLowerCase();
};

module.exports = { newObjectId, isValidObjectId, castObjectId, CastError };
