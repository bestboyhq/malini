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

export async function startFakeApi(answers: Readonly<Record<string, unknown>>): Promise<FakeApi> {
	const requests: FakeApiRequest[] = [];
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			const path = request.url ?? '/';
			requests.push({
				method: request.method ?? '',
				path,
				headers: request.headers,
				body: Buffer.concat(chunks).toString('utf8'),
			});
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
	return {
		url: `http://${site}`,
		site,
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
