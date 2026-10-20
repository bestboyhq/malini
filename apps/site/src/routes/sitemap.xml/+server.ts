import { SITE_URL } from '$lib/links';
import { pages } from '$lib/content.server';

export const prerender = true;

export function GET(): Response {
	const urls = ['', ...pages.map((page) => page.path)].map(
		(path) => `\t<url><loc>${SITE_URL}${path}</loc></url>`,
	);
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
	return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
