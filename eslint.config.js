// Flat ESLint config (ESLint 9). Minimal, dependency-free baseline (§9/§16).
module.exports = [
	{
		ignores: ['node_modules/**', 'build/**', 'coverage/**'],
	},
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
		},
		rules: {
			'no-var': 'warn',
			'prefer-const': 'warn',
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', args: 'none' }],
			eqeqeq: ['warn', 'smart'],
		},
	},
];
