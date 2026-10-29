import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import electronVite from './electron.vite.config';

const demoSrc = fileURLToPath(new URL('./src/renderer/demo', import.meta.url));

export default mergeConfig(electronVite.renderer ?? {}, {
	root: demoSrc,
	base: './',
	publicDir: fileURLToPath(new URL('./src/renderer/public', import.meta.url)),
	resolve: {
		alias: [
			{
				find: '$contract/workstream-images',
				replacement: `${demoSrc}/demo-workstream-images.ts`,
			},
		],
	},
	build: {
		outDir: fileURLToPath(new URL('../site/static/demo', import.meta.url)),
		emptyOutDir: true,
		rollupOptions: { input: [`${demoSrc}/app.html`, `${demoSrc}/card.html`] },
		target: 'es2023',
	},
});
