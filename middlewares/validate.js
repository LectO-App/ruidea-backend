// Validates and casts req.body against a zod schema before it reaches a handler.
// Closes the "trust the body / spread into Mongo" NoSQL-injection surface (§4.3, §11.1)
// by rejecting unexpected shapes and coercing fields to their expected scalar types.
const validate = schema => (req, res, next) => {
	const result = schema.safeParse(req.body);
	if (!result.success) {
		return res.status(400).json({
			message: 'Datos inválidos',
			errors: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
		});
	}
	req.body = result.data;
	next();
};

module.exports = { validate };
