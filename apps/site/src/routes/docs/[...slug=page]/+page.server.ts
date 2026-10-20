import { error } from '@sveltejs/kit';
import { findPage, pages, renderMarkdown } from '$lib/content.server';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = () => pages.map((page) => ({ slug: page.slug }));

function neighbor(index: number): { path: string; title: string } | null {
	const page = pages[index];
	return page ? { path: page.path, title: page.title } : null;
}

export const load: PageServerLoad = ({ params }) => {
	const page = findPage(params.slug);
	if (!page) error(404, 'Not found');
	const index = pages.indexOf(page);
	const { html, headings } = renderMarkdown(page.markdown);
	return {
		page: {
			slug: page.slug,
			path: page.path,
			title: page.title,
			description: page.description,
			section: page.section,
			html,
			headings: headings.filter((heading) => heading.depth === 2),
		},
		previous: neighbor(index - 1),
		next: neighbor(index + 1),
	};
};
