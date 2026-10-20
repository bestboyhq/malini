import { SITE_URL } from '$lib/links';
import { asMarkdownDocument, pages } from '$lib/content.server';

export const prerender = true;

export function GET(): Response {
	const body = pages
		.map((page) => `Source: ${SITE_URL}${page.path}\n\n${asMarkdownDocument(page)}`)
		.join('\n---\n\n');
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
