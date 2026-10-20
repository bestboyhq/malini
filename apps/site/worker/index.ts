export type Env = Readonly<{ ASSETS: Readonly<{ fetch(request: Request): Promise<Response> }> }>;

const CANONICAL_HOST = 'bestboy.dev';
const IMMUTABLE_PREFIX = '/malini/_app/immutable/';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const PAGE = 'public, max-age=0, stale-while-revalidate=86400';

function cacheControl(pathname: string): string | null {
	if (pathname.startsWith(IMMUTABLE_PREFIX)) return IMMUTABLE;
	const file = pathname.slice(pathname.lastIndexOf('/') + 1);
	return file === '__data.json' || !file.includes('.') ? PAGE : null;
}

function withPolicy(response: Response, url: URL): Response {
	const headers = new Headers(response.headers);
	headers.delete('Set-Cookie');
	if (url.hostname !== CANONICAL_HOST) headers.set('X-Robots-Tag', 'noindex');
	const policy = cacheControl(url.pathname);
	if (policy && (response.ok || response.status === 304)) headers.set('Cache-Control', policy);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
			const target = new URL(url);
			target.pathname = url.pathname.replace(/\/+$/u, '') || '/';
			return withPolicy(
				new Response(null, { status: 301, headers: { Location: target.href } }),
				url,
			);
		}
		return withPolicy(await env.ASSETS.fetch(request), url);
	},
};
