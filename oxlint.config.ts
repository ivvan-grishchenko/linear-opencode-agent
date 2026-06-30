import { defineConfig } from 'oxlint';

export default defineConfig({
	plugins: ['typescript', 'import', 'vitest', 'unicorn'],
	categories: {
		correctness: 'error',
		suspicious: 'warn',
		pedantic: 'off',
		style: 'off',
		perf: 'off',
		restriction: 'off',
	},
	env: {
		es2022: true,
	},
	globals: {
		ExecutionContext: 'readonly',
		KVNamespace: 'readonly',
		Queue: 'readonly',
		MessageBatch: 'readonly',
	},
	ignorePatterns: ['node_modules', 'dist', '.wrangler', 'worker-configuration.d.ts'],
	overrides: [
		{
			files: ['**/*.test.ts'],
			rules: {
				'vitest/require-mock-type-parameters': 'off',
			},
		},
	],
	options: {
		reportUnusedDisableDirectives: 'warn',
	},
});
