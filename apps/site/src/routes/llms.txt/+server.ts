import { llmsText } from '$lib/content.server';

export const prerender = true;

export function GET(): Response {
	return new Response(llmsText(), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
}
