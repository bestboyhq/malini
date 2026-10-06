import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TITLED_BY_LAYOUT = new Set(['WorkstreamPage.svelte']);

describe('window titles', () => {
	const pages = readdirSync(new URL('.', import.meta.url)).filter((file) =>
		file.endsWith('Page.svelte'),
	);

	it.each(pages.filter((page) => !TITLED_BY_LAYOUT.has(page)))(
		'%s names itself so the previous page title never lingers',
		(page) => {
			const source = readFileSync(new URL(page, import.meta.url), 'utf8');
			expect(source).toMatch(/<svelte:head>\s*<title>malini · [^<]+<\/title>\s*<\/svelte:head>/u);
		},
	);
});
