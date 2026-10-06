import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: { getAllWindows: () => [] } }));

import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { USAGE_DATA_SETTING } from '../domain/usage-data';
import { setSetting } from './settings.repository';
import { asBrowserWindow, createFakeHost, createTestContext } from './test-support';
import { startUsageData, type UsageMessage } from './usage-data';

function harness(
	context: MainContext = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') }),
) {
	const sent: UsageMessage[] = [];
	const host = createFakeHost();
	let clock = 1_000;
	const usage = startUsageData(context, {
		host,
		sink: { capture: (message) => sent.push(message), shutdown: () => Promise.resolve() },
		system: {},
		now: () => clock,
		sessionModel: () => 'anthropic/claude-sonnet-5',
	});
	const events = (name: string): UsageMessage[] => sent.filter((message) => message.event === name);
	return {
		context,
		sent,
		host,
		usage,
		events,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

function agentEvent(context: MainContext, event: Record<string, unknown>): void {
	context.events.emit(CHAT_AGENT_EVENT_CHANNEL, { sessionId: 's1', runId: 'r1', seq: 1, event });
}

describe('usage data', () => {
	it('counts a prompt without sending its text', async () => {
		const { context, events } = harness();
		context.commands.define('chat.send-prompt', () => 'r1');
		await context.commands.handle({
			command: 'chat.send-prompt',
			args: {
				sessionId: 's1',
				prompt: 'fix the secret thing in /Users/me/work',
				attachmentIds: ['a', 'b'],
				profile: { effort: 'high', mode: 'agent' },
			},
		});
		const [sent] = events('chat.send-prompt');
		expect(sent?.properties).toMatchObject({
			ok: true,
			prompt_length: 38,
			attachments: 2,
			effort: 'high',
			mode: 'agent',
		});
		expect(JSON.stringify(sent)).not.toContain('secret');
	});

	it('reports every failure, including commands it does not otherwise track', async () => {
		const { context, events } = harness();
		context.commands.define('repositories.list-workstreams', () => {
			throw new Error('disk gone');
		});
		await context.commands.handle({ command: 'repositories.list-workstreams', args: undefined });
		expect(events('repositories.list-workstreams')).toEqual([]);
		expect(events('app.command-failed')[0]?.properties).toMatchObject({
			command: 'repositories.list-workstreams',
			error_name: 'Error',
		});
		expect(JSON.stringify(events('app.command-failed'))).not.toContain('disk gone');
	});

	it('sends nothing once the user turns usage data off', async () => {
		const { context, sent } = harness();
		const before = sent.length;
		setSetting(context.db, USAGE_DATA_SETTING, 'off');
		context.commands.define('chat.cancel-run', () => undefined);
		await context.commands.handle({ command: 'chat.cancel-run', args: { sessionId: 's1' } });
		expect(sent.length).toBe(before);
	});

	it('summarizes an agent run when it finishes', () => {
		const { context, events, advance } = harness();
		agentEvent(context, { type: 'run.started', runId: 'r1', sessionId: 's1' });
		agentEvent(context, { type: 'tool.completed', runId: 'r1', name: 'Edit' });
		agentEvent(context, { type: 'tool.failed', runId: 'r1', name: 'Bash', error: 'x' });
		agentEvent(context, { type: 'file.changed', runId: 'r1', path: 'a.ts' });
		agentEvent(context, { type: 'file.changed', runId: 'r1', path: 'a.ts' });
		agentEvent(context, { type: 'usage.updated', runId: 'r1', inputTokens: 10, costUsd: 0.5 });
		advance(4_000);
		agentEvent(context, { type: 'run.completed', runId: 'r1', summary: 'done' });
		expect(events('chat.run-started')[0]?.properties).toMatchObject({ concurrent_runs: 1 });
		expect(events('chat.run-completed')[0]?.properties).toMatchObject({
			model: 'anthropic/claude-sonnet-5',
			duration_ms: 4_000,
			tool_calls: 2,
			tool_failures: 1,
			files_changed: 1,
			input_tokens: 10,
			cost_usd: 0.5,
		});
	});

	it('keeps one anonymous id per install', () => {
		const context = createTestContext('/tmp', { db: openMigratedDatabase(':memory:') });
		const first = harness(context).events('app.launched')[0];
		const second = harness(context).events('app.launched')[0];
		expect(first?.properties).toMatchObject({ first_launch: true });
		expect(second?.properties).toMatchObject({ first_launch: false });
		expect(second?.distinctId).toBe(first?.distinctId);
	});

	it('names screens by route, not by workstream', () => {
		const { host, events } = harness();
		const webContents = new EventEmitter();
		for (const listener of host.windowCreated) listener(asBrowserWindow({ webContents }));
		webContents.emit('did-navigate', {}, 'file:///app/index.html');
		webContents.emit(
			'did-navigate-in-page',
			{},
			'file:///app/index.html#/workstreams/w1?agent=a',
			true,
		);
		webContents.emit('did-navigate-in-page', {}, 'file:///app/index.html#/workstreams/w2', true);
		webContents.emit('did-navigate-in-page', {}, 'file:///app/index.html#/settings', true);
		expect(events('$screen').map((message) => message.properties['$screen_name'])).toEqual([
			'/',
			'/workstreams/:workstreamId',
			'/settings',
		]);
	});
});
