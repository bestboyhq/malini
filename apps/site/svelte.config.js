import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
	compilerOptions: { rootDir: fileURLToPath(new URL('../..', import.meta.url)) },
	kit: {
		adapter: adapter({ pages: 'build/malini', assets: 'build/malini', strict: true }),
		paths: { base: '/malini', relative: false },
		prerender: { handleHttpError: 'fail', handleMissingId: 'fail' },
	},
};
