import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		adapter: adapter({ pages: 'build/malini', assets: 'build/malini', strict: true }),
		paths: { base: '/malini', relative: false },
		prerender: { handleHttpError: 'fail', handleMissingId: 'fail' },
	},
};
