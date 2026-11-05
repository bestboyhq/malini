import baseConfig from '@malini/eslint-plugin-hyper-ui/base-config';

export default [
	...baseConfig,
	{
		files: ['src/**/*.{svelte,ts}'],
		rules: { '@malini/desktop/no-motion-while-hidden': 'error' },
	},
];
