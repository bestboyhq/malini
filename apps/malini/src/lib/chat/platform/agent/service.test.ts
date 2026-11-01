import { realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_JOB_BOUNDARY, type JobDefinitionRecord } from '$contract/jobs';
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
			resize: async ({ workstreamId }, width) => {
				calls.push(`resize ${workstreamId} ${width}`);
				return Math.min(Math.max(width, 400), 900);
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

		const results = (): Array<Record<string, unknown>> =>
			bridge.received.filter((command) => command['cmd'] === 'browser_result');
		await waitFor(() => results().length === 11, 5_000, 'eleven browser results');
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
			'resize ws-1 640',
			'resize ws-1 1280',
			'resize ws-1 320',
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

function jobDefinition(
	id: string,
	name: string,
	changes: Partial<JobDefinitionRecord> = {},
): JobDefinitionRecord {
	return {
		id,
		name,
		instructions: `Do ${name}.\nThen report.`,
		model: 'opus',
		effort: 'high',
		runsIn: 'workstream',
		skills: ['adr'],
		builtin: null,
		trigger: null,
		thenJobId: null,
		boundary: DEFAULT_JOB_BOUNDARY,
		createdAt: '2026-10-19T00:00:00.000Z',
		updatedAt: '2026-10-19T00:00:00.000Z',
		...changes,
	};
}

describe('platform requests from the agent', () => {
	it('manages jobs, their triggers and Thens through the registered commands and answers the bridge', async () => {
		seedWorkstream(test.db, test.appDataRoot, 'ws-1');
		seedSession(test.db, 'sess-1', 'ws-1');
		run(
			test.db,
			`INSERT INTO job_definitions (id, name, instructions, model, effort, runs_in, created_at, updated_at)
			 VALUES ('job-0', 'Triage issues', 'Triage.', 'opus', 'high', 'workstream', ?, ?)`,
			'2026-10-19T00:00:00.000Z',
			'2026-10-19T00:00:00.000Z',
		);
		run(
			test.db,
			`INSERT INTO job_runs (id, definition_id, title, workstream_id, session_id, origin, status, chain_id, created_at)
			 VALUES ('job-run-0', 'job-0', 'Triage issues', 'ws-1', 'sess-1', 'trigger', 'running', 'job-run-0', ?)`,
			'2026-10-19T00:00:00.000Z',
		);
		const calls: Array<readonly [string, unknown]> = [];
		const definitions = [
			jobDefinition('job-1', 'Update docs', {
				trigger: { when: 'on pull-requests:ship-changed where merged is set', mode: 'auto' },
				thenJobId: 'job-2',
				boundary: { ...DEFAULT_JOB_BOUNDARY, chats: 'starter' },
			}),
			jobDefinition('job-2', 'Triage'),
		];
		const { commands } = test.context;
		commands.define('jobs.list-definitions', () => definitions);
		commands.define('jobs.save-definition', (args) => {
			calls.push(['jobs.save-definition', args]);
			return jobDefinition('job-3', 'Ship notes');
		});
		commands.define('jobs.run', (args) => {
			calls.push(['jobs.run', args]);
			return {
				id: 'job-run-1',
				definitionId: 'job-1',
				title: 'Update docs',
				workstreamId: 'ws-1',
				repositoryId: null,
				scope: null,
				sessionId: null,
				agentRunId: null,
				origin: 'manual',
				status: 'queued',
				detail: null,
				parentRunId: 'job-run-0',
				chatSessionId: 'sess-1',
				chatAfterRunId: 'run-9',
				chainId: 'job-run-1',
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

		bridge.send(platformRequest('p-1', 'jobs_list', {}));
		bridge.send(
			platformRequest('p-2', 'jobs_save', {
				name: 'Ship notes',
				instructions: 'Write.',
				skills: ['humanizer'],
				when: 'on jobs:suggested',
				then: 'triage',
			}),
		);
		bridge.send(platformRequest('p-3', 'jobs_save', { id: 'job-2', effort: 'low' }));
		bridge.send(platformRequest('p-4', 'jobs_run', { job: 'update docs', context: 'PR #12' }));
		bridge.send(
			platformRequest('p-5', 'jobs_save', { id: 'job-1', when: 'on jobs:suggested', then: null }),
		);
		bridge.send(platformRequest('p-6', 'jobs_save', { id: 'job-2', when: 'on jobs:suggested' }));
		bridge.send(platformRequest('p-7', 'jobs_save', { id: 'job-1', when: null }));
		bridge.send(platformRequest('p-8', 'events_list', {}));
		bridge.send(platformRequest('p-9', 'jobs_save', { id: 'job-2', then: 'Nope' }));
		bridge.send(platformRequest('p-10', 'jobs_save', { effort: 'huge' }));
		bridge.send(platformRequest('p-11', 'jobs_run', { job: 'Triage', context: 'What I said' }));

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
				id: 'job-1',
				name: 'Update docs',
				instructions: 'Do Update docs.\nThen report.',
				runsIn: 'workstream',
				model: 'opus',
				effort: 'high',
				skills: ['adr'],
				builtin: null,
				when: 'on pull-requests:ship-changed where merged is set',
				mode: 'auto',
				then: 'job-2',
				sees: { event: 'facts', jobBefore: true, chats: 'starter', attachments: false },
				internet: true,
			},
			expect.objectContaining({ id: 'job-2', when: null, mode: null, then: null }),
		]);
		expect(calls).toHaveLength(6);
		expect(calls).toEqual(
			expect.arrayContaining([
				[
					'jobs.save-definition',
					{
						name: 'Ship notes',
						instructions: 'Write.',
						model: 'opus',
						effort: 'high',
						runsIn: 'workstream',
						skills: ['humanizer'],
						trigger: { when: 'on jobs:suggested', mode: 'off' },
						thenJobId: 'job-2',
					},
				],
				[
					'jobs.save-definition',
					{
						id: 'job-2',
						name: 'Triage',
						instructions: 'Do Triage.\nThen report.',
						model: 'opus',
						effort: 'low',
						runsIn: 'workstream',
					},
				],
				[
					'jobs.save-definition',
					expect.objectContaining({
						id: 'job-1',
						trigger: { when: 'on jobs:suggested', mode: 'auto' },
						thenJobId: null,
					}),
				],
				[
					'jobs.save-definition',
					expect.objectContaining({
						id: 'job-2',
						trigger: { when: 'on jobs:suggested', mode: 'off' },
					}),
				],
				['jobs.save-definition', expect.objectContaining({ id: 'job-1', trigger: null })],
				[
					'jobs.run',
					{
						definitionId: 'job-1',
						workstreamId: 'ws-1',
						context: 'PR #12',
						parentRunId: 'job-run-0',
						chatSessionId: 'sess-1',
						chatAfterRunId: 'run-9',
					},
				],
			]),
		);
		expect(answer('p-4')).toEqual({
			id: 'job-run-1',
			job: 'Update docs',
			status: 'queued',
			workstreamId: 'ws-1',
		});
		expect(answer('p-8')).toContainEqual(
			expect.objectContaining({ channel: 'chat:session-renamed', description: expect.any(String) }),
		);
		expect(answer('p-9')).toMatchObject({
			ok: false,
			error: 'No job is named or has the id “Nope”. Call jobs_list for the jobs.',
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
				name: 'Bright Arc',
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
		bridge.send(platformRequest('p-5', 'workstreams_archive', { workstream: 'bright arc' }));
		expect(await answer('p-5')).toBe(
			'Several workstreams are named “bright arc”. Pass the id from workstreams_list instead.',
		);
		bridge.send(platformRequest('p-6', 'workstreams_archive', { workstream: 'ws-2' }));
		expect(await answer('p-6')).toEqual({
			id: 'ws-2',
			name: 'Bright Arc',
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
