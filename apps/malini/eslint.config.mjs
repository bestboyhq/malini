import js from '@eslint/js';
import prettierCompat from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import hyperUiPlugin, { textParser } from '@malini/eslint-plugin-hyper-ui';

const TOKEN_RULES = {
	'@malini/desktop/no-legacy-color-tokens': 'error',
	'@malini/desktop/no-surface-token-border-usage': 'error',
	'@malini/desktop/no-mismatched-surface-border': 'error',
	'@malini/desktop/no-border-token-background': 'error',
	'@malini/desktop/no-fg-non-text-usage': 'error',
	'@malini/desktop/no-static-hover-token': 'error',
	'@malini/desktop/no-misused-state-fg-tokens': 'error',
	'@malini/desktop/no-literal-product-colors': 'error',
};

/**
 * The tree's roots and aliases, so the boundary rule resolves a specifier the
 * same way vite and tsconfig do.
 */
const BOUNDARY_OPTIONS = {
	libRoot: 'src/lib',
	mainRoot: 'src/main',
	contractRoot: 'src/contract',
	portRoot: 'src/lib/shared/port',
	aliases: {
		$lib: 'src/lib',
		$shared: 'src/lib/shared',
		$contract: 'src/contract',
		$main: 'src/main',
		'$hyper-ui': 'packages/hyper-ui/src',
	},
	domainPackages: ['ts-pattern'],
	compositionRoots: ['src/main/modules.ts', 'src/main/index.ts'],
	consumerDomains: ['app'],
	sharedDomains: ['repositories', 'providers'],
};

const PRODUCT_SOURCE = ['src/renderer/**/*.{svelte,ts}', 'src/lib/**/*.{svelte,ts}'];
const NON_PRODUCT_SOURCE = [
	'src/renderer/**/*.{test,spec}.{svelte,ts}',
	'src/lib/**/*.{test,spec}.{svelte,ts}',
	'src/renderer/**/*.generated.{svelte,ts}',
	'src/lib/**/*.generated.{svelte,ts}',
	'src/renderer/**/{__tests__,fixtures,generated,vendor}/**',
	'src/lib/**/{__tests__,fixtures,generated,vendor}/**',
];

export default [
	{
		ignores: [
			'**/node_modules/**',
			'**/out/**',
			'**/dist/**',
			'**/release/**',
			'**/test-results/**',
			'**/*.generated.ts',
			'*.config.{ts,mjs}',
			'svelte.config.mjs',
		],
	},
	/**
	 * Parser support only from the two recommended sets; their rule opinions are
	 * off so the exit code reflects the design-system rules alone.
	 */
	{
		rules: Object.fromEntries(
			Object.keys(js.configs.recommended.rules ?? {}).map((rule) => [rule, 'off']),
		),
	},
	{
		rules: Object.fromEntries(
			Object.keys(tseslint.configs.recommended.rules ?? {}).map((rule) => [rule, 'off']),
		),
	},
	{
		plugins: { '@malini/desktop': hyperUiPlugin },
		rules: hyperUiPlugin.configs.recommended.rules,
	},
	{
		files: PRODUCT_SOURCE,
		ignores: NON_PRODUCT_SOURCE,
		rules: {
			'@malini/desktop/prefer-hyper-ui-entrypoint': 'error',
			'@malini/desktop/no-direct-component-file-import': 'error',
			'@malini/desktop/no-external-icon-packages': 'error',
			'@malini/desktop/no-raw-button': 'error',
			'@malini/desktop/no-raw-form-control': 'error',
			'@malini/desktop/no-native-title-attributes': 'error',
			'@malini/desktop/no-bespoke-overlays': 'error',
			...TOKEN_RULES,
		},
	},
	{
		/**
		 * The rules are text scans over Svelte and CSS; they only need a Program
		 * node to anchor report locations.
		 */
		files: [
			'src/renderer/**/*.svelte',
			'src/renderer/**/*.css',
			'src/lib/**/*.svelte',
			'src/lib/**/*.css',
		],
		languageOptions: { parser: textParser },
	},
	{
		files: ['src/**/*.ts', 'src/**/*.mjs', 'tests/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
		},
	},
	{
		files: ['src/**/*.{ts,mjs,svelte}', 'tests/**/*.ts'],
		ignores: NON_PRODUCT_SOURCE,
		rules: {
			'@malini/desktop/domain-boundaries': ['error', BOUNDARY_OPTIONS],
		},
	},
	{
		files: ['scripts/**'],
		rules: {
			'@malini/desktop/domain-boundaries': 'off',
		},
	},
	prettierCompat,
];
