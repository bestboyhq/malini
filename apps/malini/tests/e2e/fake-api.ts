import { createServer, type IncomingHttpHeaders } from 'node:http';

export type FakeApiRequest = Readonly<{
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
}>;

export type FakeApi = Readonly<{
	url: string;
	site: string;
	requests: readonly FakeApiRequest[];
	close: () => Promise<void>;
}>;

type Answer = Readonly<{ status: number; body: unknown; location?: string }>;

export async function startFakeApi(answers: Readonly<Record<string, unknown>>): Promise<FakeApi> {
	const requests: FakeApiRequest[] = [];
	let url = '';
	let issued = 0;
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const path = request.url ?? '/';
			const body = Buffer.concat(chunks).toString('utf8');
			requests.push({ method: request.method ?? '', path, headers: request.headers, body });
			const signingIn = signInAnswer(new URL(path, url), url, () => `token-${(issued += 1)}`);
			if (signingIn !== null) {
				const { status, body: answer, location } = signingIn;
				response
					.writeHead(status, {
						'content-type': 'application/json',
						...(location === undefined ? {} : { location }),
					})
					.end(JSON.stringify(answer));
				return;
			}
			const answer = answers[path];
			if (typeof answer === 'string') {
				response.writeHead(200, { 'content-type': 'text/html' }).end(answer);
				return;
			}
			response
				.writeHead(answer === undefined ? 404 : 200, { 'content-type': 'application/json' })
				.end(JSON.stringify(answer ?? { detail: 'Not found.' }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('the fake API has no port');
	const site = `127.0.0.1:${address.port}`;
	url = `http://${site}`;
	return {
		url,
		site,
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

export function apiRequests(api: FakeApi): FakeApiRequest[] {
	return api.requests.filter(({ path }) => signInAnswer(new URL(path, api.url), api.url) === null);
}

export async function finishSignIn(authorizeUrl: string): Promise<void> {
	const authorized = await fetch(authorizeUrl, { redirect: 'manual' });
	const back = authorized.headers.get('location');
	if (back === null) throw new Error('the fake API did not send the sign-in back');
	await (await fetch(back)).text();
}

function signInAnswer(at: URL, url: string, token = (): string => 'token'): Answer | null {
	switch (at.pathname) {
		case '/.well-known/oauth-protected-resource':
			return { status: 200, body: { resource: url, authorization_servers: [url] } };
		case '/.well-known/oauth-authorization-server':
			return {
				status: 200,
				body: {
					issuer: url,
					authorization_endpoint: `${url}/authorize`,
					token_endpoint: `${url}/token`,
					registration_endpoint: `${url}/register`,
					code_challenge_methods_supported: ['S256'],
				},
			};
		case '/register':
			return { status: 201, body: { client_id: 'malini-e2e' } };
		case '/authorize': {
			const back = new URL(at.searchParams.get('redirect_uri') ?? '');
			back.searchParams.set('state', at.searchParams.get('state') ?? '');
			back.searchParams.set('code', 'code-1');
			back.searchParams.set('iss', url);
			return { status: 302, body: {}, location: back.href };
		}
		case '/token':
			return {
				status: 200,
				body: { access_token: token(), token_type: 'Bearer', expires_in: 3600 },
			};
		default:
			return null;
	}
}
