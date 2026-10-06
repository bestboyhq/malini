import { beforeEach, describe, expect, it } from 'vitest';
import { SessionManager, SessionAlreadyOpenError, UnknownSessionError } from '../session-manager';
import { defaultProviderRegistry, UnknownProviderError } from '../providers/registry';
import type { AgentEvent } from '../types';

describe('SessionManager', () => {
	let mgr: SessionManager;

	beforeEach(() => {
		mgr = new SessionManager();
	});

	describe('register / list', () => {
		it('registerSession stores the session and list returns it', () => {
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			const list = mgr.list();
			expect(list).toHaveLength(1);
			const rec = list[0]!;
			expect(rec).toMatchObject({
				sessionId: 's1',
				workstreamId: 'w1',
				status: 'idle',
			});
			expect(typeof rec.createdAt).toBe('number');
			expect(rec.model).toBeUndefined();
		});

		it('register with model persists it', () => {
			mgr.register({ sessionId: 's1', workstreamId: 'w1', model: 'stub-mock' });
			expect(mgr.get('s1')?.model).toBe('stub-mock');
		});

		it('records the Claude session a provider reports or the app restores', () => {
			const record = mgr.register({
				sessionId: 's1',
				workstreamId: 'w1',
				providerSessionId: 'restored-session',
			});

			mgr.emitAgentEvent({
				type: 'session.state',
				sessionId: 's1',
				status: 'running',
				providerSessionId: 'claude-session',
			});
			expect(mgr.get('s1')).toMatchObject({
				providerSessionId: 'claude-session',
				status: 'running',
			});

			mgr.setProviderSessionId('s1', 'resumed-session');
			expect(mgr.get('s1')).toMatchObject({
				providerSessionId: 'resumed-session',
				createdAt: record.createdAt,
			});
			expect(() => mgr.setProviderSessionId('no-such', 'x')).toThrow(UnknownSessionError);
		});

		it('a second register for the same sessionId throws SessionAlreadyOpenError containing ALREADY_OPEN', () => {
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			expect(() => mgr.register({ sessionId: 's1', workstreamId: 'w1' })).toThrow(
				SessionAlreadyOpenError,
			);
			expect(() => mgr.register({ sessionId: 's1', workstreamId: 'w1' })).toThrow(/ALREADY_OPEN/);
		});

		it('list() returns a stable copy (mutating the returned array does not affect storage)', () => {
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			const first = mgr.list();
			first.length = 0;
			expect(mgr.list()).toHaveLength(1);
		});

		it('get() returns undefined for unknown sessionId', () => {
			expect(mgr.get('no-such')).toBeUndefined();
		});
	});

	describe('status transitions', () => {
		it('transitions idle -> running -> waiting_for_approval -> completed', () => {
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			expect(mgr.get('s1')?.status).toBe('idle');

			mgr.setStatus('s1', 'running');
			expect(mgr.get('s1')?.status).toBe('running');

			mgr.setStatus('s1', 'waiting_for_approval');
			expect(mgr.get('s1')?.status).toBe('waiting_for_approval');

			mgr.setStatus('s1', 'completed');
			expect(mgr.get('s1')?.status).toBe('completed');
		});

		it('setStatus on unknown sessionId throws UnknownSessionError containing UNKNOWN_SESSION', () => {
			expect(() => mgr.setStatus('no-such', 'running')).toThrow(UnknownSessionError);
			expect(() => mgr.setStatus('no-such', 'running')).toThrow(/UNKNOWN_SESSION/);
		});

		it('unregister is idempotent: second unregister is a no-op returning false', () => {
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			expect(mgr.unregister('s1')).toBe(true);
			expect(mgr.unregister('s1')).toBe(false);
			expect(mgr.unregister('never-added')).toBe(false);
		});
	});

	describe('event emitter (outbox compiles)', () => {
		it('AgentEvent outbox: registered listener receives exactly the emitted events', () => {
			const received: string[] = [];
			mgr.onAgentEvent((ev) => received.push(ev.type));

			mgr.emitAgentEvent({ type: 'run.started', runId: 'r1', sessionId: 's1' });
			mgr.emitAgentEvent({ type: 'assistant.message', runId: 'r1', text: 'hi' });
			mgr.emitAgentEvent({ type: 'run.completed', runId: 'r1', summary: 'done' });

			expect(received).toEqual(['run.started', 'assistant.message', 'run.completed']);
		});

		it('AgentEvent outbox: emits session.state alongside stream events', () => {
			const received: string[] = [];
			mgr.onAgentEvent((ev) => received.push(ev.type));
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			mgr.emitAgentEvent({ type: 'session.state', sessionId: 's1', status: 'running' });
			mgr.emitAgentEvent({ type: 'session.state', sessionId: 's1', status: 'completed' });
			expect(received).toEqual(['session.state', 'session.state']);
		});

		it('timestamps a deterministic long-running tool at the provider boundary', () => {
			let now = 1_000;
			const timedManager = new SessionManager(() => now);
			const received: AgentEvent[] = [];
			timedManager.onAgentEvent((event) => received.push(event));

			timedManager.emitAgentEvent({
				type: 'tool.started',
				runId: 'r1',
				name: 'Bash',
				toolCallId: 'tool-1',
			});
			now += 30_000;
			timedManager.emitAgentEvent({
				type: 'tool.completed',
				runId: 'r1',
				name: 'Bash',
				toolCallId: 'tool-1',
			});

			const [started, completed] = received;
			expect(started).toMatchObject({ type: 'tool.started', ts: 1_000 });
			expect(completed).toMatchObject({ type: 'tool.completed', ts: 31_000 });
			if (started?.type !== 'tool.started' || completed?.type !== 'tool.completed') {
				throw new Error('expected paired tool lifecycle events');
			}
			expect(completed.ts! - started.ts!).toBe(30_000);
		});

		it('preserves authoritative provider tool timestamps', () => {
			const timedManager = new SessionManager(() => 99_999);
			const received: AgentEvent[] = [];
			timedManager.onAgentEvent((event) => received.push(event));

			timedManager.emitAgentEvent({
				type: 'tool.failed',
				runId: 'r1',
				name: 'Bash',
				error: 'boom',
				ts: 12_345,
			});

			expect(received[0]).toMatchObject({ type: 'tool.failed', ts: 12_345 });
		});

		it('lifecycle events: session.opened, session.status, session.closed all fire', () => {
			const opened: string[] = [];
			const closed: string[] = [];
			const statusChanges: Array<{ sessionId: string; status: string }> = [];
			mgr.onLifecycle((evt) => {
				if (evt.kind === 'session.opened') opened.push(evt.sessionId);
				if (evt.kind === 'session.closed') closed.push(evt.sessionId);
				if (evt.kind === 'session.status') statusChanges.push(evt.change);
			});

			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			mgr.setStatus('s1', 'running');
			mgr.setStatus('s1', 'completed');
			mgr.unregister('s1');

			expect(opened).toEqual(['s1']);
			expect(closed).toEqual(['s1']);
			expect(statusChanges).toEqual([
				{ sessionId: 's1', status: 'running' },
				{ sessionId: 's1', status: 'completed' },
			]);
		});

		it('does not leak listener registrations across SessionsManagers (per-instance)', () => {
			const m1 = new SessionManager();
			const m2 = new SessionManager();
			const seen: string[] = [];
			m1.onLifecycle((e) => seen.push(`m1:${e.kind}`));
			m2.register({ sessionId: 'x', workstreamId: 'w' });
			expect(seen).toEqual([]);
		});

		it('supports multiple listeners attached to the same emitter', () => {
			const a: string[] = [];
			const b: string[] = [];
			mgr.onAgentEvent((ev) => a.push(ev.type));
			mgr.onAgentEvent((ev) => b.push(ev.type));
			mgr.emitAgentEvent({ type: 'run.started', runId: 'r1', sessionId: 's1' });
			expect(a).toEqual(['run.started']);
			expect(b).toEqual(['run.started']);
		});
	});

	describe('size', () => {
		it('size() reflects the number of registered sessions', () => {
			expect(mgr.size()).toBe(0);
			mgr.register({ sessionId: 's1', workstreamId: 'w1' });
			mgr.register({ sessionId: 's2', workstreamId: 'w1' });
			expect(mgr.size()).toBe(2);
			mgr.unregister('s1');
			expect(mgr.size()).toBe(1);
		});
	});
});

describe('defaultProviderRegistry (A9 stub factory slot)', () => {
	beforeEach(() => {
		defaultProviderRegistry.clear();
	});

	it('starts with no registered agent factory', () => {
		expect(defaultProviderRegistry.hasProvider()).toBe(false);
	});

	it('setProvider / hasProvider / getProvider work as a factory slot', async () => {
		const calls: string[] = ['init'];
		defaultProviderRegistry.setProvider(async (_ctx, emit) => {
			calls.push('factory');
			return {
				async sendPrompt(p, _runId) {
					calls.push(`send:${p}`);
					emit({ type: 'assistant.message', runId: 'r1', text: p });
				},
				async cancel() {
					calls.push('cancel');
				},
				async close() {
					calls.push('close');
				},
			};
		});

		expect(defaultProviderRegistry.hasProvider()).toBe(true);

		const emitted: string[] = [];
		const handle = await defaultProviderRegistry.getProvider(
			{ sessionId: 'sx', workstreamId: 'wx', cwd: '/tmp' },
			(ev) => emitted.push(ev.type),
		);
		await handle.sendPrompt('hi', 'r1');
		expect(calls).toEqual(['init', 'factory', 'send:hi']);
		expect(emitted).toEqual(['assistant.message']);
	});

	it('getProvider without a registered factory throws UnknownProviderError', async () => {
		await expect(
			defaultProviderRegistry.getProvider(
				{ sessionId: 'sx', workstreamId: 'wx', cwd: '/tmp' },
				() => undefined,
			),
		).rejects.toBeInstanceOf(UnknownProviderError);
		await expect(
			defaultProviderRegistry.getProvider(
				{ sessionId: 'sx', workstreamId: 'wx', cwd: '/tmp' },
				() => undefined,
			),
		).rejects.toThrow(/UNKNOWN_PROVIDER/);
	});

	it('setProvider replaces the registered factory', async () => {
		defaultProviderRegistry.setProvider(async (_ctx, _emit) => {
			throw new Error('unreachable');
		});
		defaultProviderRegistry.setProvider(async (_ctx, _emit) => ({
			async sendPrompt() {},
			async cancel() {},
			async close() {},
		}));
		const handle = await defaultProviderRegistry.getProvider(
			{ sessionId: 'sx', workstreamId: 'wx', cwd: '/tmp' },
			() => undefined,
		);
		expect(handle.sendPrompt).toBeTypeOf('function');
	});

	it('clear() empties the registry', () => {
		defaultProviderRegistry.setProvider(async (_ctx, _emit) => {
			throw new Error('unreachable');
		});
		expect(defaultProviderRegistry.hasProvider()).toBe(true);
		defaultProviderRegistry.clear();
		expect(defaultProviderRegistry.hasProvider()).toBe(false);
	});
});
