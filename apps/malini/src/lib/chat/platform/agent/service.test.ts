import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRunLeases } from './lifecycle';
import type { BridgeProcess, BridgeProcessFactory } from './process';
import {
	BRIDGE_CONTRACT_NAME,
	BRIDGE_HEARTBEAT_INTERVAL_MS,
	BRIDGE_PROTOCOL_VERSION,
} from './protocol';
import { startAgentService, type AgentService, type BrowserAutomation } from './service';
import {
	createTestContext,
	seedSession,
	seedWorkstream,
	waitFor,
	type TestContext,
} from './test-support';

interface ScriptedBridge {
	readonly factory: BridgeProcessFactory;
	readonly received: Array<Record<string, unknown>>;
	send(frame: Record<string, unknown>): void;
}

function scriptedBridge(): ScriptedBridge {
	const received: Array<Record<string, unknown>> = [];
	let stdout: PassThrough | null = null;
	const send = (frame: Record<string, unknown>): void => {
		stdout?.write(`${JSON.stringify(frame)}\n`);
	};
	const factory: BridgeProcessFactory = {
		spawn() {
			const stdin = new PassThrough();
			const out = new PassThrough();
			stdout = out;
			let exited = false;
			const exitListeners: Array<(code: number | null) => void> = [];
			const heartbeat = setInterval(
				() =>
					send({
						type: 'bridge.heartbeat',
						protocolVersion: BRIDGE_PROTOCOL_VERSION,
						ts: Date.now(),
					}),
				50,
			);
			createInterface({ input: stdin }).on('line', (line) => {
				const command: unknown = JSON.parse(line);
				if (typeof command !== 'object' || command === null) return;
				const record = Object.fromEntries(Object.entries(command));
				received.push(record);
				send({
					type: 'bridge.command_ack',
					protocolVersion: BRIDGE_PROTOCOL_VERSION,
					id: record['id'],
					accepted: true,
				});
			});
			const exit = (): void => {
				if (exited) return;
				exited = true;
				clearInterval(heartbeat);
				out.end();
				for (const listener of exitListeners.splice(0)) listener(0);
			};
			send({
				type: 'bridge.ready',
				contractName: BRIDGE_CONTRACT_NAME,
				protocolVersion: BRIDGE_PROTOCOL_VERSION,
				pid: 4242,
				heartbeatIntervalMs: BRIDGE_HEARTBEAT_INTERVAL_MS,
				capabilities: [
					{
						state: 'ready',
						installed: true,
						authenticated: true,
						version: 'scripted',
						account: null,
						models: [{ id: 'opus', label: 'Opus', description: 'd', efforts: ['low'] }],
						defaultModel: 'opus',
						message: 'Ready',
					},
				],
			});
			const child: BridgeProcess = {
				pid: 4242,
				stdin,
				stdout: out,
				stderr: null,
				leadsProcessGroup: false,
				kill: exit,
				onExit(listener) {
					if (exited) listener(0);
					else exitListeners.push(listener);
				},
				exited: () => exited,
			};
			return Promise.resolve(child);
		},
	};
	return { factory, received, send };
}

let test: TestContext;
let service: AgentService | undefined;

beforeEach(() => {
	test = createTestContext();
});

afterEach(async () => {
	await service?.stop();
	service = undefined;
	test.cleanup();
});

function browserRequest(requestId: string, action: Record<string, unknown>, sessionId = 'sess-1') {
	return {
		type: 'bridge.browser_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId,
		sessionId,
		...action,
	};
}

describe('browser requests from the agent', () => {
	it('runs each request against the browser of the session workstream and answers the bridge', async () => {
		const checkout = seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const calls: string[] = [];
		const browser: BrowserAutomation = {
			open: async ({ workstreamId, tabId }, url) => {
				calls.push(`open ${workstreamId} ${tabId} ${url}`);
				return { url: 'http://localhost:5173/', title: 'Pricing' };
			},
			screenshot: async ({ workstreamId }, worktree) => {
				calls.push(`screenshot ${workstreamId} ${worktree}`);
				return {
					path: '.malini/sandbox/screenshots/2026-10-11-104512.png',
					previewPath: join(worktree, '.malini/sandbox/screenshots/2026-10-11-104512.jpg'),
					url: 'http://localhost:5173/',
				};
			},
			click: async ({ workstreamId }, selector) => {
				calls.push(`click ${workstreamId} ${selector}`);
				throw new Error(`Nothing on the page matches \`${selector}\`.`);
			},
			type: async ({ workstreamId }, selector, text, submit) => {
				calls.push(`type ${workstreamId} ${selector} ${text} ${submit}`);
				return { url: 'http://localhost:5173/search?q=pro', title: 'Search' };
			},
			goBack: async ({ workstreamId }) => {
				calls.push(`back ${workstreamId}`);
				return { url: 'http://localhost:5173/', title: 'Pricing' };
			},
			goForward: async ({ workstreamId }) => {
				calls.push(`forward ${workstreamId}`);
				throw new Error('There is no page to go forward to.');
			},
			reload: async ({ workstreamId }) => {
				calls.push(`reload ${workstreamId}`);
				return { url: 'http://localhost:5173/', title: 'http://localhost:5173/' };
			},
		};
		const bridge = scriptedBridge();
		service = await startAgentService(test.context, {
			processFactory: bridge.factory,
			bridgeScriptPath: test.appDataRoot,
			spawnEnvironment: () => ({}),
			leases: new AgentRunLeases(),
			hooks: { captureCheckpoint: () => Promise.resolve('checkpoint') },
			browser,
			log: () => {},
		});

		bridge.send(browserRequest('req-1', { action: 'open', url: 'localhost:5173' }));
		bridge.send(browserRequest('req-2', { action: 'screenshot' }));
		bridge.send(browserRequest('req-3', { action: 'click', selector: '#buy' }));
		bridge.send(browserRequest('req-4', { action: 'screenshot' }, 'sess-unknown'));
		bridge.send(
			browserRequest('req-5', { action: 'type', selector: '#q', text: 'pro', submit: true }),
		);
		bridge.send(browserRequest('req-6', { action: 'back' }));
		bridge.send(browserRequest('req-7', { action: 'forward' }));
		bridge.send(browserRequest('req-8', { action: 'reload' }));

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'browser_result');
		await waitFor(() => results().length === 8, 5_000, 'eight browser results');
		const answerTo = (requestId: string): Record<string, unknown> | undefined =>
			results().find((command) => command['requestId'] === requestId);

		const worktree = realpathSync(checkout);
		expect(calls).toEqual([
			'open ws-1 chat-sess-1 localhost:5173',
			`screenshot ws-1 ${worktree}`,
			'click ws-1 #buy',
			'type ws-1 #q pro true',
			'back ws-1',
			'forward ws-1',
			'reload ws-1',
		]);
		expect(answerTo('req-1')).toEqual({
			cmd: 'browser_result',
			id: expect.any(String),
			sessionId: 'sess-1',
			requestId: 'req-1',
			ok: true,
			text: 'Opened http://localhost:5173/ ("Pricing"). Call browser_screenshot to see it.',
		});
		expect(answerTo('req-2')).toEqual({
			cmd: 'browser_result',
			id: expect.any(String),
			sessionId: 'sess-1',
			requestId: 'req-2',
			ok: true,
			text: 'Screenshot of http://localhost:5173/ saved to .malini/sandbox/screenshots/2026-10-11-104512.png. Embed it in your report as ![what it shows](.malini/sandbox/screenshots/2026-10-11-104512.png).',
			imagePath: join(worktree, '.malini/sandbox/screenshots/2026-10-11-104512.jpg'),
		});
		expect(answerTo('req-3')).toMatchObject({
			ok: false,
			error: 'Nothing on the page matches `#buy`.',
		});
		expect(answerTo('req-4')).toMatchObject({
			sessionId: 'sess-unknown',
			ok: false,
			error: 'Agent session `sess-unknown` is unknown.',
		});
		expect(answerTo('req-5')).toMatchObject({
			ok: true,
			text: 'Typed into `#q` and pressed Enter. The page is now http://localhost:5173/search?q=pro ("Search").',
		});
		expect(answerTo('req-6')).toMatchObject({
			ok: true,
			text: 'Went back to http://localhost:5173/ ("Pricing").',
		});
		expect(answerTo('req-7')).toMatchObject({
			ok: false,
			error: 'There is no page to go forward to.',
		});
		expect(answerTo('req-8')).toMatchObject({
			ok: true,
			text: 'Reloaded http://localhost:5173/.',
		});
	});

	it('answers with an error when malini has no browser to drive', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		const bridge = scriptedBridge();
		service = await startAgentService(test.context, {
			processFactory: bridge.factory,
			bridgeScriptPath: test.appDataRoot,
			spawnEnvironment: () => ({}),
			leases: new AgentRunLeases(),
			hooks: { captureCheckpoint: () => Promise.resolve('checkpoint') },
			log: () => {},
		});

		bridge.send(browserRequest('req-1', { action: 'screenshot' }));
		await waitFor(() => bridge.received.some((command) => command['cmd'] === 'browser_result'));

		expect(bridge.received.find((command) => command['cmd'] === 'browser_result')).toMatchObject({
			requestId: 'req-1',
			ok: false,
			error: 'The malini browser is not available.',
		});
	});
});
