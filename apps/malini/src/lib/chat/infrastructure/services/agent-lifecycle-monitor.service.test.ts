import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '$lib/chat/domain/events';
import type { LiveEventEnvelope } from '$contract/agent';
import type { AgentAttention, AgentWorkstreamContext } from '$lib/chat/domain/agent-attention';
import { AgentLifecycleMonitor } from './agent-lifecycle-monitor.service';

function monitorHarness() {
	let listener: ((payload: LiveEventEnvelope) => void) | null = null;
	const sessions = new Map<string, { workstreamId: string; status: string }>();
	const contexts = new Map<string, AgentWorkstreamContext>();
	const attentions = new Map<string, AgentAttention>();
	const notifications: Array<{
		title: string;
		body: string;
		workstreamId: string;
		sessionId: string;
	}> = [];
	const unlisten = vi.fn();
	let subscribeCount = 0;

	const monitor = new AgentLifecycleMonitor({
		subscribe: (next) => {
			subscribeCount += 1;
			listener = next;
			return unlisten;
		},
		applyLifecycle: (envelope: EventEnvelope) => {
			const session = sessions.get(envelope.sessionId) ?? {
				workstreamId: '_unknown',
				status: 'idle',
			};
			if (envelope.event.type === 'run.started') session.status = 'running';
			if (envelope.event.type === 'approval.requested') session.status = 'waiting_for_approval';
			if (envelope.event.type === 'run.completed') session.status = 'completed';
			if (envelope.event.type === 'run.failed') session.status = 'failed';
			sessions.set(envelope.sessionId, session);
		},
		sessionFor: (sessionId) => sessions.get(sessionId) ?? null,
		appFocused: () => true,
		queueCountFor: () => 0,
		contextFor: (workstreamId) => contexts.get(workstreamId) ?? null,
		clearAttention: (workstreamId) => attentions.delete(workstreamId),
		clearAttentionForRun: (workstreamId, runId) => {
			if (attentions.get(workstreamId)?.runId !== runId) return false;
			return attentions.delete(workstreamId);
		},
		markAttention: (workstreamId, attention) => {
			const existing = attentions.get(workstreamId);
			if (existing?.runId === attention.runId && existing.kind === attention.kind) return false;
			attentions.set(workstreamId, attention);
			return true;
		},
		notify: (title, body, workstreamId, sessionId) => {
			notifications.push({ title, body, workstreamId, sessionId });
		},
	});

	return {
		monitor,
		sessions,
		contexts,
		attentions,
		notifications,
		unlisten,
		subscribeCount: () => subscribeCount,
		emit(payload: LiveEventEnvelope) {
			if (!listener) throw new Error('monitor is not subscribed');
			listener(payload);
		},
	};
}

function context(owner: string, workstreamId: string): AgentWorkstreamContext {
	return {
		workstreamId,
		label: `${workstreamId} label`,
		repositoryFullName: `${owner}/repo`,
		branch: `malini/${workstreamId}`,
	};
}

function envelope(
	sessionId: string,
	runId: string,
	seq: number,
	event: LiveEventEnvelope['event'],
): LiveEventEnvelope {
	return { sessionId, runId, seq, event };
}

describe('AgentLifecycleMonitor', () => {
	it('keeps inactive workstreams truthful while active work remains notification-free', () => {
		const harness = monitorHarness();
		harness.sessions.set('session-a', { workstreamId: 'stream-a', status: 'running' });
		harness.sessions.set('session-b', { workstreamId: 'stream-b', status: 'running' });
		harness.contexts.set('stream-a', context('acme', 'stream-a'));
		harness.contexts.set('stream-b', context('globex', 'stream-b'));
		harness.monitor.setActiveWorkstream('stream-a');
		harness.monitor.start();

		harness.emit(
			envelope('session-b', 'run-b', 2, {
				type: 'run.completed',
				runId: 'run-b',
				summary: 'Beta is ready.',
			}),
		);
		expect(harness.sessions.get('session-b')?.status).toBe('completed');
		expect(harness.attentions.get('stream-b')?.kind).toBe('completed');
		expect(harness.notifications).toEqual([
			{
				title: 'stream-b label finished',
				body: 'Beta is ready.',
				workstreamId: 'stream-b',
				sessionId: 'session-b',
			},
		]);
		expect(harness.attentions.get('stream-b')?.sessionId).toBe('session-b');

		harness.emit(
			envelope('session-a', 'run-a', 2, {
				type: 'run.completed',
				runId: 'run-a',
				summary: 'Alpha is ready.',
			}),
		);
		expect(harness.sessions.get('session-a')?.status).toBe('completed');
		expect(harness.attentions.has('stream-a')).toBe(false);
		expect(harness.notifications).toHaveLength(1);
	});

	it('clears old terminal attention when a new background run starts', () => {
		const harness = monitorHarness();
		harness.sessions.set('session-a', { workstreamId: 'stream-a', status: 'completed' });
		harness.contexts.set('stream-a', context('acme', 'stream-a'));
		harness.attentions.set('stream-a', {
			kind: 'completed',
			runId: 'old-run',
			updatedAt: 1,
		});
		harness.monitor.start();

		harness.emit(
			envelope('session-a', 'new-run', 3, {
				type: 'run.started',
				runId: 'new-run',
				sessionId: 'session-a',
			}),
		);
		expect(harness.sessions.get('session-a')?.status).toBe('running');
		expect(harness.attentions.has('stream-a')).toBe(false);
	});

	it('does not notify twice when the same terminal envelope is delivered again', () => {
		const harness = monitorHarness();
		harness.sessions.set('session-a', { workstreamId: 'stream-a', status: 'running' });
		harness.contexts.set('stream-a', context('acme', 'stream-a'));
		harness.monitor.start();
		const completed = envelope('session-a', 'run-a', 3, {
			type: 'run.completed',
			runId: 'run-a',
			summary: 'Ready once.',
		});

		harness.emit(completed);
		harness.emit(completed);

		expect(harness.notifications).toEqual([
			{
				title: 'stream-a label finished',
				body: 'Ready once.',
				workstreamId: 'stream-a',
				sessionId: 'session-a',
			},
		]);
		expect(harness.attentions.get('stream-a')?.kind).toBe('completed');
	});

	it('retires approval attention when that run is explicitly cancelled', () => {
		const harness = monitorHarness();
		harness.sessions.set('session-a', {
			workstreamId: 'stream-a',
			status: 'waiting_for_approval',
		});
		harness.contexts.set('stream-a', context('acme', 'stream-a'));
		harness.attentions.set('stream-a', {
			kind: 'approval',
			runId: 'run-a',
			updatedAt: 1,
		});
		harness.monitor.start();

		harness.emit(
			envelope('session-a', 'run-a', 3, {
				type: 'run.failed',
				runId: 'run-a',
				error: 'cancelled',
			}),
		);

		expect(harness.sessions.get('session-a')?.status).toBe('failed');
		expect(harness.attentions.has('stream-a')).toBe(false);
		expect(harness.notifications).toEqual([]);
	});

	it('buffers an ownership race and routes attention after session hydration', () => {
		const harness = monitorHarness();
		harness.contexts.set('stream-b', context('globex', 'stream-b'));
		harness.monitor.start();

		harness.emit(
			envelope('session-late', 'run-late', 9, {
				type: 'run.failed',
				runId: 'run-late',
				error: 'Build failed',
			}),
		);
		expect(harness.sessions.get('session-late')?.workstreamId).toBe('_unknown');
		expect(harness.notifications).toEqual([]);

		harness.sessions.set('session-late', { workstreamId: 'stream-b', status: 'failed' });
		harness.monitor.flushKnownSessions();
		expect(harness.attentions.get('stream-b')?.kind).toBe('failed');
		expect(harness.notifications).toEqual([
			{
				title: 'stream-b label needs attention',
				body: 'Build failed',
				workstreamId: 'stream-b',
				sessionId: 'session-late',
			},
		]);
	});

	it('subscribes once and releases the subscription on shell teardown', () => {
		const harness = monitorHarness();

		harness.monitor.start();
		harness.monitor.start();
		expect(harness.subscribeCount()).toBe(1);
		expect(harness.unlisten).not.toHaveBeenCalled();

		harness.monitor.stop();
		expect(harness.unlisten).toHaveBeenCalledOnce();

		harness.monitor.start();
		expect(harness.subscribeCount()).toBe(2);
	});

	it('ignores ephemeral and non-lifecycle traffic', () => {
		const harness = monitorHarness();
		harness.monitor.start();
		harness.emit(
			envelope('session-a', 'run-a', 1, {
				type: 'assistant.delta',
				runId: 'run-a',
				contentId: 'block-a',
				text: 'streaming',
			}),
		);
		harness.emit({
			...envelope('session-a', 'run-a', 2, {
				type: 'run.completed',
				runId: 'run-a',
				summary: 'ignored',
			}),
			ephemeral: true,
		});
		expect(harness.sessions.size).toBe(0);
	});
});
