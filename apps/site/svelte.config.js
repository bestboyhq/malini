import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';

const DEMO_PAGES = new Set(['/malini/demo/app', '/malini/demo/card']);

/** @type {import('@sveltejs/kit').Config} */
export default {
	compilerOptions: { rootDir: fileURLToPath(new URL('../..', import.meta.url)) },
	kit: {
		adapter: adapter({ pages: 'build/malini', assets: 'build/malini', strict: true }),
		paths: { base: '/malini', relative: false },
		prerender: {
			handleHttpError: ({ path, message }) => {
				if (!DEMO_PAGES.has(path)) throw new Error(message);
			},
			handleMissingId: 'fail',
		},
	},
};
