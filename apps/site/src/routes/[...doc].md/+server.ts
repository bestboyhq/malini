import { error } from '@sveltejs/kit';
import { pages } from '$lib/content.server';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;

export const entries: EntryGenerator = () => pages.map((page) => ({ doc: page.path.slice(1) }));

export const GET: RequestHandler = ({ params }) => {
	const page = pages.find(({ path }) => path === `/${params.doc}`);
	if (!page) error(404, 'Not found');
	return new Response(page.source, {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
};
