import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatformForTest } from '$shared/port/platform';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import { agentRunner } from './agent-runner.service.svelte';

function installPlatform(): FakePlatform {
	const platform = createFakePlatform();
	platform.define('chat.start-session', async () => 'sess-mock');
	platform.define('chat.send-prompt', async () => 'run-mock');
	platform.define('chat.cancel-run', async () => {});
	setPlatformForTest(platform);
	return platform;
}

function agentCalls(platform: FakePlatform): { command: string; args: unknown }[] {
	return platform.calls.filter(({ command }) => command !== 'chat.agent-health');
}

function lastArgs(platform: FakePlatform): unknown {
	return agentCalls(platform).at(-1)?.args;
}

describe('agentRunner startSession/sendPrompt/cancelRun', () => {
	let platform: FakePlatform;

	beforeEach(() => {
		platform = installPlatform();
		agentRunner.__resetForTests();
	});

	afterEach(() => {
		setPlatformForTest(null);
		agentRunner.__resetForTests();
		vi.resetModules();
	});

	it('startSession invokes chat.start-session with workstreamId and the default model', async () => {
		const sessionId = await agentRunner.startSession({
			workstreamId: 'ws-1',
		});

		expect(sessionId).toBe('sess-mock');
		expect(agentCalls(platform)).toEqual([
			{
				command: 'chat.start-session',
				args: { workstreamId: 'ws-1', model: 'default' },
			},
		]);
		expect(agentRunner.modelForSession(sessionId)).toBe('default');
	});

	it('startSession passes through explicit model and remembers it', async () => {
		const sessionId = await agentRunner.startSession({
			workstreamId: 'ws-2',
			model: 'opus',
		});
		expect(sessionId).toBe('sess-mock');
		expect(lastArgs(platform)).toMatchObject({ model: 'opus' });
		expect(agentRunner.modelForSession(sessionId)).toBe('opus');
	});

	it('modelForSession returns undefined when sessionId is unknown', () => {
		expect(agentRunner.modelForSession('never-seen')).toBeUndefined();
	});

	it('sendPrompt invokes chat.send-prompt and returns the runId', async () => {
		const runId = await agentRunner.sendPrompt({
			sessionId: 'sess-pre',
			prompt: 'ping',
		});
		expect(runId).toBe('run-mock');
		expect(agentCalls(platform)).toEqual([
			{ command: 'chat.send-prompt', args: { sessionId: 'sess-pre', prompt: 'ping' } },
		]);
	});

	it('sendPrompt forwards a durable client request id for queued dispatches', async () => {
		await agentRunner.sendPrompt({
			sessionId: 'sess-queued',
			prompt: 'run this next',
			clientRequestId: 'queue-request-123',
		});
		expect(lastArgs(platform)).toEqual({
			sessionId: 'sess-queued',
			prompt: 'run this next',
			clientRequestId: 'queue-request-123',
		});
	});

	it('sendPrompt forwards selected workstream context files without changing the visible prompt', async () => {
		await agentRunner.sendPrompt({
			sessionId: 'sess-context',
			prompt: 'Tighten the hero spacing',
			contextFiles: ['src/routes/+page.svelte', 'src/lib/hero.ts'],
		});
		expect(lastArgs(platform)).toEqual({
			sessionId: 'sess-context',
			prompt: 'Tighten the hero spacing',
			contextFiles: ['src/routes/+page.svelte', 'src/lib/hero.ts'],
		});
	});

	it('sendPrompt forwards only staged attachment ids', async () => {
		await agentRunner.sendPrompt({
			sessionId: 'sess-attachments',
			prompt: 'Inspect the brief',
			attachmentIds: ['att-one', 'att-two'],
		});
		expect(lastArgs(platform)).toEqual({
			sessionId: 'sess-attachments',
			prompt: 'Inspect the brief',
			attachmentIds: ['att-one', 'att-two'],
		});
	});

	it('sendPrompt forwards the typed per-prompt effort and mode profile', async () => {
		await agentRunner.sendPrompt({
			sessionId: 'sess-profile',
			prompt: 'Plan the change',
			profile: { effort: 'high', mode: 'plan', access: 'sandboxed' },
		});
		expect(lastArgs(platform)).toEqual({
			sessionId: 'sess-profile',
			prompt: 'Plan the change',
			profile: { effort: 'high', mode: 'plan', access: 'sandboxed' },
		});
	});

	it('sendPrompt unwraps a reactive profile before the IPC boundary', async () => {
		const reactiveProfile = new Proxy(
			{ effort: 'high' as const, mode: 'plan' as const, access: 'sandboxed' as const },
			{ get: (target, key) => Reflect.get(target, key) },
		);

		await agentRunner.sendPrompt({
			sessionId: 'sess-proxy',
			prompt: 'Plan the change',
			profile: reactiveProfile,
		});

		const args = lastArgs(platform);
		const profile = typeof args === 'object' && args !== null ? Reflect.get(args, 'profile') : null;
		expect(() => structuredClone(profile)).not.toThrow();
		expect(profile).toEqual({ effort: 'high', mode: 'plan', access: 'sandboxed' });
	});

	it('cancelRun invokes chat.cancel-run with the sessionId', async () => {
		await agentRunner.cancelRun('sess-cancel');
		expect(agentCalls(platform)).toEqual([
			{ command: 'chat.cancel-run', args: { sessionId: 'sess-cancel' } },
		]);
	});

	it('cancelRun names the prompt still being sent, so Stop reaches a run that has not started', async () => {
		pendingPromptStore.set({
			sessionId: 'sess-cancel',
			origin: 'composer',
			runId: 'run-req-1',
			text: 'HANG',
			attachments: [],
			issueReferences: [],
		});
		await agentRunner.cancelRun('sess-cancel');
		pendingPromptStore.set(null);
		expect(agentCalls(platform)).toEqual([
			{ command: 'chat.cancel-run', args: { sessionId: 'sess-cancel', pendingRunId: 'run-req-1' } },
		]);
	});

	it('propagates platform startSession errors', async () => {
		platform.define('chat.start-session', async () => {
			throw new Error('agent unavailable');
		});
		await expect(agentRunner.startSession({ workstreamId: 'ws' })).rejects.toThrow(
			/agent unavailable/u,
		);
	});
});

describe('bridge-death watchdog (U13)', () => {
	let platform: FakePlatform;

	beforeEach(() => {
		vi.useFakeTimers();
		platform = installPlatform();
		agentRunner.__resetForTests();
	});

	afterEach(() => {
		agentRunner.setRunOpen(false);
		agentRunner.__resetForTests();
		setPlatformForTest(null);
		vi.useRealTimers();
	});

	it('does not poll before a run is open', async () => {
		let calls = 0;
		platform.define('chat.agent-health', () => {
			calls += 1;
			return Promise.resolve(false);
		});

		await vi.advanceTimersByTimeAsync(10_000);

		expect(calls).toBe(0);
		expect(agentRunner.bridgeDead).toBe(false);
	});

	it('flips bridgeDead once a poll observes the bridge unhealthy while a run is open', async () => {
		let healthy = true;
		platform.define('chat.agent-health', () => Promise.resolve(healthy));

		agentRunner.setRunOpen(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(agentRunner.bridgeDead).toBe(false);

		healthy = false;
		await vi.advanceTimersByTimeAsync(2000);
		expect(agentRunner.bridgeDead).toBe(true);
	});

	it('stops polling once the run closes', async () => {
		let calls = 0;
		platform.define('chat.agent-health', () => {
			calls += 1;
			return Promise.resolve(true);
		});

		agentRunner.setRunOpen(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(calls).toBe(1);

		agentRunner.setRunOpen(false);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(calls).toBe(1);
	});

	it('clearBridgeDead resets the sticky flag', async () => {
		platform.define('chat.agent-health', () => Promise.resolve(false));

		agentRunner.setRunOpen(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(agentRunner.bridgeDead).toBe(true);

		agentRunner.clearBridgeDead();
		expect(agentRunner.bridgeDead).toBe(false);
	});

	it('setRunOpen(true) called twice does not double the poll cadence', async () => {
		let calls = 0;
		platform.define('chat.agent-health', () => {
			calls += 1;
			return Promise.resolve(true);
		});

		agentRunner.setRunOpen(true);
		agentRunner.setRunOpen(true);
		await vi.advanceTimersByTimeAsync(2000);

		expect(calls).toBe(1);
	});

	it('keeps health checks single-flight and turns a hung check into recovery state', async () => {
		let calls = 0;
		platform.define('chat.agent-health', async () => {
			calls += 1;
			return await new Promise<boolean>(() => {});
		});

		agentRunner.setRunOpen(true);
		await vi.advanceTimersByTimeAsync(5_999);
		expect(calls).toBe(1);
		expect(agentRunner.bridgeDead).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toBe(1);
		expect(agentRunner.bridgeDead).toBe(true);

		await vi.advanceTimersByTimeAsync(10_000);
		expect(calls).toBe(1);
	});

	it('ignores a health deadline after the run has already closed', async () => {
		platform.define('chat.agent-health', async () => await new Promise<boolean>(() => {}));

		agentRunner.setRunOpen(true);
		await vi.advanceTimersByTimeAsync(2_000);
		agentRunner.setRunOpen(false);
		await vi.advanceTimersByTimeAsync(4_000);

		expect(agentRunner.bridgeDead).toBe(false);
	});

	it('rejects a stale unhealthy poll after close then reopen starts a new run generation', async () => {
		const resolvers: Array<(healthy: boolean) => void> = [];
		let calls = 0;
		platform.define('chat.agent-health', () => {
			calls += 1;
			return new Promise<boolean>((resolve) => resolvers.push(resolve));
		});
		const owner = { workstreamId: 'workstream-a', sessionId: 'session-a' };

		agentRunner.setRunOpen(true, owner);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(calls).toBe(1);
		agentRunner.setRunOpen(false, owner);
		agentRunner.setRunOpen(true, owner);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(calls).toBe(2);

		resolvers[0]?.(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(agentRunner.bridgeDeadFor(owner)).toBe(false);
		resolvers[1]?.(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(agentRunner.bridgeDeadFor(owner)).toBe(false);
	});

	it('scopes bridge death to its owning workstream and session', async () => {
		platform.define('chat.agent-health', () => Promise.resolve(false));
		const ownerA = { workstreamId: 'workstream-a', sessionId: 'session-a' };
		const ownerB = { workstreamId: 'workstream-b', sessionId: 'session-b' };

		agentRunner.setRunOpen(true, ownerA);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(agentRunner.bridgeDeadFor(ownerA)).toBe(true);
		expect(agentRunner.bridgeDeadFor(ownerB)).toBe(false);

		agentRunner.setRunOpen(false, ownerA);
		agentRunner.setRunOpen(true, ownerB);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(agentRunner.bridgeDeadFor(ownerA)).toBe(true);
		expect(agentRunner.bridgeDeadFor(ownerB)).toBe(true);

		agentRunner.clearBridgeDead(ownerB);
		expect(agentRunner.bridgeDeadFor(ownerA)).toBe(true);
		expect(agentRunner.bridgeDeadFor(ownerB)).toBe(false);
	});
});
