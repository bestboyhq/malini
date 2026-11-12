import { realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DEFAULT_AUTOMATION_BOUNDARY,
	type AutomationDefinitionRecord,
} from '$contract/automations';
import { all, run } from '$main/db/rows';
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

function seedInternetOffAutomation(): void {
	run(
		test.db,
		`INSERT INTO automation_definitions (id, name, instructions, model, effort, runs_in, reaches_internet, created_at, updated_at)
		 VALUES ('automation-off', 'Offline automation', 'Work offline.', 'opus', 'high', 'workstream', 0, ?, ?)`,
		'2026-10-19T00:00:00.000Z',
		'2026-10-19T00:00:00.000Z',
	);
	run(
		test.db,
		`INSERT INTO automation_runs (id, definition_id, title, workstream_id, session_id, origin, status, chain_id, created_at)
		 VALUES ('automation-run-off', 'automation-off', 'Offline automation', 'ws-1', 'sess-1', 'manual', 'running', 'automation-run-off', ?)`,
		'2026-10-19T00:00:00.000Z',
	);
}

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
		let closed = false;
		const browser: BrowserAutomation = {
			open: async ({ workstreamId, tabId }, url) => {
				calls.push(`open ${workstreamId} ${tabId} ${url}`);
				return { url: 'http://localhost:5173/', title: 'Pricing' };
			},
			readPage: async ({ workstreamId }) => {
				calls.push(`snapshot ${workstreamId}`);
				return 'Page "Pricing" at http://localhost:5173/\nbutton "Buy" @e1';
			},
			screenshot: async ({ workstreamId }, worktree, part) => {
				calls.push(`screenshot ${workstreamId} ${worktree} ${JSON.stringify(part)}`);
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
			hover: async ({ workstreamId }, selector) => {
				calls.push(`hover ${workstreamId} ${selector}`);
				return { url: 'http://localhost:5173/', title: 'Pricing' };
			},
			press: async ({ workstreamId }, key) => {
				calls.push(`press ${workstreamId} ${key}`);
				return { url: 'http://localhost:5173/', title: 'Pricing' };
			},
			scroll: async ({ workstreamId }, by) => {
				calls.push(`scroll ${workstreamId} ${JSON.stringify(by)}`);
				return by.selector === undefined
					? { x: 0, y: 600, height: 2400 }
					: { x: 0, y: 120, height: 900, container: 'div.list' };
			},
			wait: async ({ workstreamId }, until) => {
				calls.push(`wait ${workstreamId} ${JSON.stringify(until)}`);
				return { url: 'http://localhost:5173/', title: 'Pricing' };
			},
			evaluate: async ({ workstreamId }, script) => {
				calls.push(`evaluate ${workstreamId} ${script}`);
				return '"Pricing"';
			},
			consoleLines: async ({ workstreamId }) => {
				calls.push(`console ${workstreamId}`);
				return {
					url: 'http://localhost:5173/',
					lines: [
						{ level: 'error', text: 'Uncaught TypeError: x is null', source: 'app.js:12' },
						{ level: 'info', text: 'ready', source: '' },
					],
					dropped: 3,
				};
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
			resize: async ({ workstreamId }, width, height) => {
				calls.push(`resize ${workstreamId} ${width} ${height}`);
				return { width: Math.min(Math.max(width, 400), 900), height: height ?? 800 };
			},
			close: async ({ workstreamId, tabId }) => {
				calls.push(`close ${workstreamId} ${tabId}`);
				const wasOpen = !closed;
				closed = true;
				return wasOpen;
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
		bridge.send(browserRequest('req-9', { action: 'resize', width: 640 }));
		bridge.send(browserRequest('req-10', { action: 'resize', width: 1280 }));
		bridge.send(browserRequest('req-11', { action: 'resize', width: 320 }));
		bridge.send(browserRequest('req-12', { action: 'close' }));
		bridge.send(browserRequest('req-13', { action: 'close' }));
		bridge.send(browserRequest('req-14', { action: 'snapshot' }));
		bridge.send(browserRequest('req-15', { action: 'hover', selector: '@e1' }));
		bridge.send(browserRequest('req-16', { action: 'press', key: 'Escape' }));
		bridge.send(browserRequest('req-17', { action: 'scroll', y: 600 }));
		bridge.send(browserRequest('req-18', { action: 'scroll', y: 120, selector: '.list' }));
		bridge.send(browserRequest('req-19', { action: 'wait', seconds: 5, text: 'Saved' }));
		bridge.send(browserRequest('req-20', { action: 'wait', seconds: 1 }));
		bridge.send(browserRequest('req-21', { action: 'evaluate', script: 'document.title' }));
		bridge.send(browserRequest('req-22', { action: 'console' }));
		bridge.send(browserRequest('req-23', { action: 'resize', width: 640, height: 844 }));

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'browser_result');
		await waitFor(() => results().length === 23, 5_000, 'twenty-three browser results');
		const answerTo = (requestId: string): Record<string, unknown> | undefined =>
			results().find((command) => command['requestId'] === requestId);

		const worktree = realpathSync(checkout);
		expect(calls).toEqual([
			'open ws-1 chat-sess-1 localhost:5173',
			`screenshot ws-1 ${worktree} {"fullPage":false}`,
			'click ws-1 #buy',
			'type ws-1 #q pro true',
			'back ws-1',
			'forward ws-1',
			'reload ws-1',
			'resize ws-1 640 undefined',
			'resize ws-1 1280 undefined',
			'resize ws-1 320 undefined',
			'close ws-1 chat-sess-1',
			'close ws-1 chat-sess-1',
			'snapshot ws-1',
			'hover ws-1 @e1',
			'press ws-1 Escape',
			'scroll ws-1 {"x":0,"y":600}',
			'scroll ws-1 {"x":0,"y":120,"selector":".list"}',
			'wait ws-1 {"seconds":5,"gone":false,"text":"Saved"}',
			'wait ws-1 {"seconds":1,"gone":false}',
			'evaluate ws-1 document.title',
			'console ws-1',
			'resize ws-1 640 844',
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
		expect(answerTo('req-9')).toMatchObject({ ok: true, text: 'The page is now 640px wide.' });
		expect(answerTo('req-10')).toMatchObject({
			ok: true,
			text: "The page is now 900px wide, the widest Malini's window allows while the chat keeps its minimum width.",
		});
		expect(answerTo('req-11')).toMatchObject({
			ok: true,
			text: "The page is now 400px wide, the narrowest the inspector gets in Malini's window.",
		});
		expect(answerTo('req-12')).toMatchObject({
			ok: true,
			text: 'Closed your browser tab and its page.',
		});
		expect(answerTo('req-13')).toMatchObject({
			ok: true,
			text: 'You had no browser tab open, so nothing closed.',
		});
		expect(answerTo('req-14')).toMatchObject({
			ok: true,
			text: 'Page "Pricing" at http://localhost:5173/\nbutton "Buy" @e1',
		});
		expect(answerTo('req-15')).toMatchObject({
			ok: true,
			text: 'The mouse is over `@e1`. The page is now http://localhost:5173/ ("Pricing").',
		});
		expect(answerTo('req-16')).toMatchObject({
			ok: true,
			text: 'Pressed Escape. The page is now http://localhost:5173/ ("Pricing").',
		});
		expect(answerTo('req-17')).toMatchObject({
			ok: true,
			text: 'The page is scrolled to x 0, y 600 of 2400px.',
		});
		expect(answerTo('req-18')).toMatchObject({
			ok: true,
			text: 'div.list is scrolled to x 0, y 120 of 900px.',
		});
		expect(answerTo('req-19')).toMatchObject({
			ok: true,
			text: '"Saved" shows. The page is http://localhost:5173/ ("Pricing").',
		});
		expect(answerTo('req-20')).toMatchObject({
			ok: true,
			text: 'Waited 1s. The page is http://localhost:5173/ ("Pricing").',
		});
		expect(answerTo('req-21')).toMatchObject({ ok: true, text: '"Pricing"' });
		expect(answerTo('req-22')).toMatchObject({
			ok: true,
			text: [
				'2 console messages of http://localhost:5173/ since it loaded, after 3 older ones Malini no longer keeps:',
				'[error] Uncaught TypeError: x is null (app.js:12)',
				'[info] ready',
			].join('\n'),
		});
		expect(answerTo('req-23')).toMatchObject({
			ok: true,
			text: 'The page is now 640px wide and 844px tall.',
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
			error: 'The Malini browser is not available.',
		});
	});

	it('keeps the browser closed to an automation whose internet is off', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		seedInternetOffAutomation();
		const unused = async (): Promise<never> => {
			throw new Error('The browser must not be used.');
		};
		const browser: BrowserAutomation = {
			open: unused,
			readPage: unused,
			screenshot: unused,
			click: unused,
			hover: unused,
			type: unused,
			press: unused,
			scroll: unused,
			wait: unused,
			evaluate: unused,
			consoleLines: unused,
			goBack: unused,
			goForward: unused,
			reload: unused,
			resize: unused,
			close: unused,
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

		bridge.send(browserRequest('req-1', { action: 'open', url: 'https://example.com' }));
		await waitFor(() => bridge.received.some((command) => command['cmd'] === 'browser_result'));

		expect(bridge.received.find((command) => command['cmd'] === 'browser_result')).toMatchObject({
			requestId: 'req-1',
			ok: false,
			error: expect.stringContaining('internet off'),
		});
	});
});

function platformRequest(requestId: string, tool: string, input: Record<string, unknown>) {
	return {
		type: 'bridge.platform_request',
		protocolVersion: BRIDGE_PROTOCOL_VERSION,
		requestId,
		sessionId: 'sess-1',
		runId: 'run-9',
		tool,
		input,
	};
}

function automationDefinition(
	id: string,
	name: string,
	changes: Partial<AutomationDefinitionRecord> = {},
): AutomationDefinitionRecord {
	return {
		id,
		name,
		instructions: `Do ${name}.\nThen report.`,
		provider: 'claude',
		model: 'opus',
		effort: 'high',
		runsIn: 'workstream',
		skills: ['adr'],
		builtin: null,
		trigger: null,
		thenAutomationId: null,
		boundary: DEFAULT_AUTOMATION_BOUNDARY,
		createdAt: '2026-10-19T00:00:00.000Z',
		updatedAt: '2026-10-19T00:00:00.000Z',
		...changes,
	};
}

describe('platform requests from the agent', () => {
	it('manages automations, their triggers and Thens through the registered commands and answers the bridge', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		run(
			test.db,
			`INSERT INTO automation_definitions (id, name, instructions, model, effort, runs_in, created_at, updated_at)
			 VALUES ('automation-0', 'Triage issues', 'Triage.', 'opus', 'high', 'workstream', ?, ?)`,
			'2026-10-19T00:00:00.000Z',
			'2026-10-19T00:00:00.000Z',
		);
		run(
			test.db,
			`INSERT INTO automation_runs (id, definition_id, title, workstream_id, session_id, origin, status, chain_id, created_at)
			 VALUES ('automation-run-0', 'automation-0', 'Triage issues', 'ws-1', 'sess-1', 'trigger', 'running', 'automation-run-0', ?)`,
			'2026-10-19T00:00:00.000Z',
		);
		const calls: Array<readonly [string, unknown]> = [];
		const definitions = [
			automationDefinition('automation-1', 'Update docs', {
				trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
				thenAutomationId: 'automation-2',
				boundary: { ...DEFAULT_AUTOMATION_BOUNDARY, chats: 'starter' },
			}),
			automationDefinition('automation-2', 'Triage'),
		];
		const { commands } = test.context;
		commands.define('automations.list-definitions', () => definitions);
		commands.define('automations.save-definition', (args) => {
			calls.push(['automations.save-definition', args]);
			return automationDefinition('automation-3', 'Ship notes');
		});
		commands.define('automations.run', (args) => {
			calls.push(['automations.run', args]);
			return {
				id: 'automation-run-1',
				definitionId: 'automation-1',
				title: 'Update docs',
				workstreamId: 'ws-1',
				repositoryId: null,
				sessionId: null,
				agentRunId: null,
				origin: 'manual',
				status: 'queued',
				interrupted: false,
				detail: null,
				parentRunId: 'automation-run-0',
				chatSessionId: 'sess-1',
				chatAfterRunId: 'run-9',
				chainId: 'automation-run-1',
				requests: 1,
				createdAt: '2026-10-19T00:00:00.000Z',
				startedAt: null,
				finishedAt: null,
			};
		});
		const bridge = scriptedBridge();
		service = await startAgentService(test.context, {
			processFactory: bridge.factory,
			bridgeScriptPath: test.appDataRoot,
			spawnEnvironment: () => ({}),
			leases: new AgentRunLeases(),
			hooks: { captureCheckpoint: () => Promise.resolve('checkpoint') },
			log: () => {},
		});

		bridge.send(platformRequest('p-1', 'automations_list', {}));
		bridge.send(
			platformRequest('p-2', 'automations_save', {
				name: 'Ship notes',
				instructions: 'Write.',
				skills: ['humanizer'],
				when: 'on automations:suggested',
				then: 'triage',
			}),
		);
		bridge.send(platformRequest('p-3', 'automations_save', { id: 'automation-2', effort: 'low' }));
		bridge.send(
			platformRequest('p-4', 'automations_run', { automation: 'update docs', context: 'PR #12' }),
		);
		bridge.send(
			platformRequest('p-5', 'automations_save', {
				id: 'automation-1',
				when: 'on automations:suggested',
				then: null,
			}),
		);
		bridge.send(
			platformRequest('p-6', 'automations_save', {
				id: 'automation-2',
				when: 'on automations:suggested',
			}),
		);
		bridge.send(platformRequest('p-7', 'automations_save', { id: 'automation-1', when: null }));
		bridge.send(platformRequest('p-8', 'events_list', {}));
		bridge.send(platformRequest('p-9', 'automations_save', { id: 'automation-2', then: 'Nope' }));
		bridge.send(platformRequest('p-10', 'automations_save', { effort: 'huge' }));
		bridge.send(
			platformRequest('p-11', 'automations_run', { automation: 'Triage', context: 'What I said' }),
		);

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'platform_result');
		await waitFor(() => results().length === 11, 5_000, 'eleven platform results');
		const answer = (requestId: string): unknown => {
			const result = results().find((command) => command['requestId'] === requestId);
			if (result?.['ok'] !== true) return result;
			return JSON.parse(String(result['text']));
		};
		expect(answer('p-1')).toEqual([
			{
				id: 'automation-1',
				name: 'Update docs',
				instructions: 'Do Update docs.\nThen report.',
				runsIn: 'workstream',
				model: 'opus',
				effort: 'high',
				skills: ['adr'],
				builtin: null,
				when: 'on pull-requests:ship-changed where merged is set',
				mode: 'auto',
				then: 'automation-2',
				sees: { event: 'facts', automationBefore: true, chats: 'starter', attachments: false },
				internet: true,
			},
			expect.objectContaining({ id: 'automation-2', when: null, mode: null, then: null }),
		]);
		expect(calls).toHaveLength(6);
		expect(calls).toEqual(
			expect.arrayContaining([
				[
					'automations.save-definition',
					{
						name: 'Ship notes',
						instructions: 'Write.',
						provider: 'claude',
						model: 'opus',
						effort: 'high',
						runsIn: 'workstream',
						skills: ['humanizer'],
						trigger: { when: 'on automations:suggested', mode: 'off' },
						thenAutomationId: 'automation-2',
					},
				],
				[
					'automations.save-definition',
					{
						id: 'automation-2',
						name: 'Triage',
						instructions: 'Do Triage.\nThen report.',
						provider: 'claude',
						model: 'opus',
						effort: 'low',
						runsIn: 'workstream',
					},
				],
				[
					'automations.save-definition',
					expect.objectContaining({
						id: 'automation-1',
						trigger: { when: 'on automations:suggested', mode: 'auto' },
						thenAutomationId: null,
					}),
				],
				[
					'automations.save-definition',
					expect.objectContaining({
						id: 'automation-2',
						trigger: { when: 'on automations:suggested', mode: 'off' },
					}),
				],
				[
					'automations.save-definition',
					expect.objectContaining({ id: 'automation-1', trigger: null }),
				],
				[
					'automations.run',
					{
						definitionId: 'automation-1',
						workstreamId: 'ws-1',
						context: 'PR #12',
						parentRunId: 'automation-run-0',
						chatSessionId: 'sess-1',
						chatAfterRunId: 'run-9',
					},
				],
			]),
		);
		expect(answer('p-4')).toEqual({
			id: 'automation-run-1',
			automation: 'Update docs',
			status: 'queued',
			workstreamId: 'ws-1',
		});
		expect(answer('p-8')).toContainEqual(
			expect.objectContaining({ channel: 'chat:session-renamed', description: expect.any(String) }),
		);
		expect(answer('p-9')).toMatchObject({
			ok: false,
			error:
				'No automation is named or has the id “Nope”. Call automations_list for the automations.',
		});
		expect(answer('p-10')).toMatchObject({
			ok: false,
			error: '`effort` must be one of low, medium, high, xhigh, max.',
		});
		expect(answer('p-11')).toMatchObject({
			ok: false,
			error: expect.stringContaining('Triage does not see your chats'),
		});
	});

	it('refuses every tool that would reach out for an automation whose internet is off', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		seedInternetOffAutomation();
		const { commands } = test.context;
		commands.define('automations.list-definitions', () => [
			automationDefinition('automation-net', 'Reachable'),
		]);
		const bridge = scriptedBridge();
		service = await startAgentService(test.context, {
			processFactory: bridge.factory,
			bridgeScriptPath: test.appDataRoot,
			spawnEnvironment: () => ({}),
			leases: new AgentRunLeases(),
			hooks: { captureCheckpoint: () => Promise.resolve('checkpoint') },
			log: () => {},
		});

		bridge.send(platformRequest('n-1', 'repositories_clone', { repository: 'acme/away' }));
		bridge.send(
			platformRequest('n-2', 'workstreams_create', { repository: 'acme/away', prompt: 'Go' }),
		);
		bridge.send(
			platformRequest('n-3', 'workstreams_send', { workstream: 'elsewhere', prompt: 'Go' }),
		);
		bridge.send(platformRequest('n-4', 'automations_run', { automation: 'Reachable' }));

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'platform_result');
		await waitFor(() => results().length === 4, 5_000, 'four platform results');
		for (const requestId of ['n-1', 'n-2', 'n-3', 'n-4']) {
			expect(results().find((command) => command['requestId'] === requestId)).toMatchObject({
				ok: false,
				error: expect.stringContaining('internet off'),
			});
		}
	});

	it('lists, hides and archives through the registered commands, never archives its own workstream, and logs every call', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedWorkstream(test.db, test.appDataRoot, 'ws-2');
		seedSession(test.db, 'sess-1', 'ws-1');
		const calls: Array<readonly [string, unknown]> = [];
		const { commands } = test.context;
		commands.define('repositories.set-hidden', (args) => {
			calls.push(['repositories.set-hidden', args]);
		});
		commands.define('repositories.archive-workstream', (args) => {
			calls.push(['repositories.archive-workstream', args]);
			return { savedWork: null };
		});
		const bridge = scriptedBridge();
		service = await startAgentService(test.context, {
			processFactory: bridge.factory,
			bridgeScriptPath: test.appDataRoot,
			spawnEnvironment: () => ({}),
			leases: new AgentRunLeases(),
			hooks: { captureCheckpoint: () => Promise.resolve('checkpoint') },
			log: () => {},
		});

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'platform_result');
		const answer = async (requestId: string): Promise<unknown> => {
			await waitFor(
				() => results().some((command) => command['requestId'] === requestId),
				5_000,
				requestId,
			);
			const result = results().find((command) => command['requestId'] === requestId);
			return result?.['ok'] === true ? JSON.parse(String(result['text'])) : result?.['error'];
		};
		bridge.send(platformRequest('p-1', 'repositories_list', {}));
		const repositories = await answer('p-1');
		expect(repositories).toHaveLength(2);
		expect(repositories).toEqual(
			expect.arrayContaining([
				{
					id: 'local:project-ws-1',
					name: 'project-ws-1',
					defaultBranch: 'main',
					cloned: true,
					hidden: false,
				},
				expect.objectContaining({ id: 'local:project-ws-2', cloned: true }),
			]),
		);
		bridge.send(platformRequest('p-2', 'repositories_hide', { repository: 'Project-WS-2' }));
		expect(await answer('p-2')).toMatchObject({ id: 'local:project-ws-2', hidden: true });
		bridge.send(platformRequest('p-3', 'workstreams_list', { repository: 'project-ws-1' }));
		expect(await answer('p-3')).toEqual([
			{
				id: 'ws-1',
				name: 'New workstream',
				repository: 'project-ws-1',
				branch: 'malini/ws-1',
				baseBranch: 'main',
				current: true,
				startedBy: null,
				working: false,
				outcome: null,
				needs: null,
				merged: null,
			},
		]);
		bridge.send(platformRequest('p-4', 'workstreams_archive', { workstream: 'ws-1' }));
		expect(await answer('p-4')).toBe(
			'This chat runs in that workstream, so you cannot archive it. The user archives it from the sidebar.',
		);
		bridge.send(platformRequest('p-5', 'workstreams_archive', { workstream: 'new workstream' }));
		expect(await answer('p-5')).toBe(
			'Several workstreams are named “new workstream”. Pass the id from workstreams_list instead.',
		);
		bridge.send(platformRequest('p-6', 'workstreams_archive', { workstream: 'ws-2' }));
		expect(await answer('p-6')).toEqual({
			id: 'ws-2',
			name: 'New workstream',
			archived: true,
			savedWork: null,
		});
		bridge.send(platformRequest('p-7', 'repositories_clone', { repository: '--upload-pack=x' }));
		expect(await answer('p-7')).toBe(
			'`repository` must be owner/name, or a git URL that starts with https://, ssh://, file:// or git@.',
		);

		expect(calls).toEqual([
			['repositories.set-hidden', { repoId: 'local:project-ws-2', hidden: true }],
			['repositories.archive-workstream', { workstreamId: 'ws-2' }],
		]);
		expect(
			all(
				test.db,
				'SELECT tool, workstream_id, status, approval FROM agent_actions ORDER BY rowid',
			),
		).toEqual([
			{
				tool: 'repositories_list',
				workstream_id: 'ws-1',
				status: 'succeeded',
				approval: 'not-needed',
			},
			{
				tool: 'repositories_hide',
				workstream_id: 'ws-1',
				status: 'succeeded',
				approval: 'not-needed',
			},
			{
				tool: 'workstreams_list',
				workstream_id: 'ws-1',
				status: 'succeeded',
				approval: 'not-needed',
			},
			{
				tool: 'workstreams_archive',
				workstream_id: 'ws-1',
				status: 'failed',
				approval: 'not-needed',
			},
			{
				tool: 'workstreams_archive',
				workstream_id: 'ws-1',
				status: 'failed',
				approval: 'not-needed',
			},
			{
				tool: 'workstreams_archive',
				workstream_id: 'ws-1',
				status: 'succeeded',
				approval: 'not-needed',
			},
			{
				tool: 'repositories_clone',
				workstream_id: 'ws-1',
				status: 'failed',
				approval: 'not-needed',
			},
		]);
	});

	it('opens a file for the user beside the chat, never answers with what it holds, and logs the call', async () => {
		const worktree = seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		writeFileSync(join(worktree, 'notes.md'), 'the plan\n');
		const outside = join(realpathSync(test.appDataRoot), 'secrets', 'malini.keys');
		const bridge = scriptedBridge();
		service = await startAgentService(test.context, {
			processFactory: bridge.factory,
			bridgeScriptPath: test.appDataRoot,
			spawnEnvironment: () => ({}),
			leases: new AgentRunLeases(),
			hooks: { captureCheckpoint: () => Promise.resolve('checkpoint') },
			log: () => {},
		});

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'platform_result');
		const answer = async (requestId: string): Promise<unknown> => {
			await waitFor(
				() => results().some((command) => command['requestId'] === requestId),
				5_000,
				requestId,
			);
			const result = results().find((command) => command['requestId'] === requestId);
			return result?.['ok'] === true ? JSON.parse(String(result['text'])) : result?.['error'];
		};
		bridge.send(platformRequest('p-1', 'files_open', { path: 'notes.md', line: 2 }));
		expect(await answer('p-1')).toEqual({ path: 'notes.md', created: false });
		bridge.send(platformRequest('p-2', 'files_open', { path: outside }));
		expect(await answer('p-2')).toEqual({ path: outside, created: true });
		bridge.send(platformRequest('p-3', 'files_open', { path: 'notes.md', line: 0 }));
		expect(await answer('p-3')).toBe('`line` must be a line number from 1.');

		expect(statSync(outside).mode & 0o777).toBe(0o600);
		expect(JSON.stringify(results())).not.toContain('the plan');
		expect(
			test.events.frames
				.filter(({ channel }) => channel === 'extensions:file-open-requested')
				.map(({ payload }) => payload),
		).toEqual([
			{ workstreamId: 'ws-1', path: 'notes.md', line: 2 },
			{ workstreamId: 'ws-1', path: outside, line: null },
		]);
		expect(all(test.db, 'SELECT tool, status, approval FROM agent_actions ORDER BY rowid')).toEqual(
			[
				{ tool: 'files_open', status: 'succeeded', approval: 'not-needed' },
				{ tool: 'files_open', status: 'succeeded', approval: 'not-needed' },
				{ tool: 'files_open', status: 'failed', approval: 'not-needed' },
			],
		);
	});
});
