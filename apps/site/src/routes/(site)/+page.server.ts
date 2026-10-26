import { error } from '@sveltejs/kit';
import { findPage, llmsText } from '$lib/content.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const jobs = findPage('jobs');
	if (!jobs) error(500, 'content/jobs.md is missing');
	return {
		llms: llmsText().split('\n'),
		doc: { path: jobs.path, lines: jobs.source.split('\n') },
	};
};
