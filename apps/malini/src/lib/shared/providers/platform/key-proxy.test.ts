import { createServer, type IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { missingKey } from '$shared/providers/domain/provider-env';
import { KeyProxy } from './key-proxy';

interface Received {
	readonly url: string;
	readonly headers: IncomingHttpHeaders;
	readonly body: string;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

async function provider(
	replies: { status: number; type: string; body: string }[],
): Promise<{ baseUrl: string; received: Received[] }> {
	const received: Received[] = [];
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			received.push({
				url: request.url ?? '',
				headers: request.headers,
				body: Buffer.concat(chunks).toString(),
			});
			const reply = replies.shift() ?? { status: 500, type: 'text/plain', body: 'no reply' };
			response.writeHead(reply.status, { 'content-type': reply.type });
			response.end(reply.body);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(() => server.close());
	const address = server.address();
	const port = typeof address === 'object' && address !== null ? address.port : 0;
	return { baseUrl: `http://127.0.0.1:${port}/anthropic`, received };
}

function keyProxy(baseUrl: string): KeyProxy {
	const proxy = new KeyProxy({
		fetch: (url, init) => fetch(url, init),
		upstream: async (providerId) => {
			if (providerId !== 'deepseek') throw missingKey('OpenCode');
			return { baseUrl, apiKey: 'sk-real-deepseek' };
		},
	});
	cleanups.push(() => proxy.stop());
	return proxy;
}

const STREAM =
	'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {}\n\n';

describe('KeyProxy', () => {
	it('sends Claude Code on to the provider with the real key and passes every answer back', async () => {
		const upstream = await provider([
			{ status: 200, type: 'text/event-stream', body: STREAM },
			{ status: 429, type: 'application/json', body: '{"error":{"message":"Slow down"}}' },
		]);
		const { baseUrl, token } = await keyProxy(upstream.baseUrl).address('deepseek');
		expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/deepseek$/u);
		expect(token).not.toContain('sk-real');
		const turn = (): Promise<Response> =>
			fetch(`${baseUrl}/v1/messages?beta=true`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${token}`,
					'anthropic-version': '2023-06-01',
					'anthropic-beta': 'claude-code-20250219',
					'content-type': 'application/json',
					'x-claude-code-session-id': 'session-1',
				},
				body: '{"model":"deepseek-v4-pro"}',
			});

		const streamed = await turn();
		expect(streamed.status).toBe(200);
		expect(streamed.headers.get('content-type')).toBe('text/event-stream');
		expect(await streamed.text()).toBe(STREAM);
		const limited = await turn();
		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: { message: 'Slow down' } });

		expect(upstream.received).toHaveLength(2);
		const [first] = upstream.received;
		expect(first?.url).toBe('/anthropic/v1/messages?beta=true');
		expect(first?.body).toBe('{"model":"deepseek-v4-pro"}');
		expect(first?.headers).toMatchObject({
			authorization: 'Bearer sk-real-deepseek',
			'anthropic-version': '2023-06-01',
			'anthropic-beta': 'claude-code-20250219',
			'x-claude-code-session-id': 'session-1',
		});
		expect(JSON.stringify(first?.headers)).not.toContain(token);
	});

	it('refuses a stranger, any other path, and a provider with no key, without calling out', async () => {
		const upstream = await provider([]);
		const proxy = keyProxy(upstream.baseUrl);
		const { baseUrl, token } = await proxy.address('deepseek');
		const origin = new URL(baseUrl).origin;
		const post = (path: string, secret = token, method = 'POST'): Promise<Response> =>
			fetch(`${origin}${path}`, {
				method,
				headers: { authorization: `Bearer ${secret}`, 'x-api-key': secret },
				...(method === 'POST' ? { body: '{}' } : {}),
			});

		const stranger = await post('/deepseek/v1/messages', 'not-the-token');
		expect(stranger.status).toBe(401);
		expect(await stranger.json()).toEqual({
			type: 'error',
			error: { type: 'authentication_error', message: 'Malini did not recognize this caller.' },
		});
		for (const path of [
			'/deepseek/v1/models',
			'/deepseek/v1/messages/../../account',
			'/deepseek',
		]) {
			expect((await post(path)).status).toBe(404);
		}
		expect((await post('/deepseek/v1/messages', token, 'GET')).status).toBe(404);
		const unconnected = await post('/opencode/v1/messages');
		expect(unconnected.status).toBe(401);
		expect(await unconnected.json()).toEqual({
			type: 'error',
			error: {
				type: 'authentication_error',
				message: 'OpenCode needs an API key. Add it in Settings, then try again.',
			},
		});
		expect(upstream.received).toEqual([]);
	});
});
