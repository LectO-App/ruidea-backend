const mongoose = require('mongoose');

// Atomic sequence store. Replaces `countDocuments()+1001`, which races and produces
// duplicate passport numbers under concurrent acceptances (SECURITY_ASSESSMENT.md §5.1).
const Counter = mongoose.Schema({
	_id: { type: String, required: true },
	seq: { type: Number, default: 1000 },
});

module.exports = mongoose.model('counter', Counter);
