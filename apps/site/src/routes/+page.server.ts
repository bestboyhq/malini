import { error } from '@sveltejs/kit';
import { findPage, llmsText } from '$lib/content.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const routines = findPage('routines');
	if (!routines) error(500, 'content/routines.md is missing');
	return {
		llms: llmsText().split('\n'),
		doc: { path: routines.path, lines: routines.source.split('\n') },
	};
};
