import prettierCompat from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import hyperUiPlugin, { textParser } from './index.mjs';

const universalIgnores = {
	ignores: [
		'**/node_modules/**',
		'**/dist/**',
		'**/out/**',
		'**/release/**',
		'**/test-results/**',
		'**/*.generated.{ts,mjs,js}',
	],
};

const codeRules = {
	plugins: { '@malini/desktop': hyperUiPlugin },
	rules: hyperUiPlugin.configs.recommended?.rules ?? {},
};

const textFiles = {
	files: ['**/*.svelte', '**/*.css'],
	languageOptions: { parser: textParser },
};

const scriptFiles = {
	files: ['**/*.{ts,mjs,js}'],
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
};

/** @type {import('eslint').Linter.Config[]} */
const baseConfig = [universalIgnores, codeRules, textFiles, scriptFiles, prettierCompat];

export default baseConfig;
export { universalIgnores };
