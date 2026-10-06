import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { LiveEventEnvelope } from '$contract/agent';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { notificationService } from '$shared/system/notification.service';
import { agentAttentionDecision } from '$lib/chat/domain/agent-attention';
import { agentActivity } from '../aggregates/agent-activity.aggregate.svelte';
import { agentPromptQueue } from '../aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '../aggregates/sessions.aggregate.svelte';

const HANDLED_LIFECYCLE_EVENT_LIMIT = 2_048;

type SessionOwner = {
	workstreamId: string;
};

type AgentLifecycleMonitorDependencies = {
	subscribe(listener: (payload: LiveEventEnvelope) => void): () => void;
	applyLifecycle(envelope: EventEnvelope): void;
	sessionFor(sessionId: SessionId): SessionOwner | null;
	appFocused(): boolean;
	queueCountFor(workstreamId: string): number;
	contextFor: typeof agentActivity.contextFor;
	clearAttention: typeof agentActivity.clear;
	clearAttentionForRun: typeof agentActivity.clearForRun;
	markAttention: typeof agentActivity.mark;
	notify(
		title: string,
		body: string,
		workstreamId: string,
		sessionId: SessionId,
	): void | Promise<void>;
};

function lifecycleEvent(value: unknown): value is AgentEvent {
	if (typeof value !== 'object' || value === null || !('type' in value)) return false;
	const type = value.type;
	return (
		type === 'run.started' ||
		type === 'approval.requested' ||
		type === 'question.requested' ||
		type === 'run.completed' ||
		type === 'run.failed'
	);
}

function eventEnvelope(payload: LiveEventEnvelope): EventEnvelope | null {
	if (
		payload.ephemeral === true ||
		!payload.sessionId ||
		!payload.runId ||
		!Number.isFinite(payload.seq) ||
		!lifecycleEvent(payload.event)
	) {
		return null;
	}
	return {
		sessionId: payload.sessionId,
		runId: payload.runId,
		seq: payload.seq,
		event: payload.event,
	};
}

export class AgentLifecycleMonitor {
	#unlisten: (() => void) | null = null;
	#pendingAttentionBySession = new Map<SessionId, EventEnvelope>();
	#handledLifecycleKeys = new Set<string>();
	#handledLifecycleOrder: string[] = [];
	#activeWorkstreamId = '';

	constructor(private readonly dependencies: AgentLifecycleMonitorDependencies) {}

	setActiveWorkstream(workstreamId: string): void {
		this.#activeWorkstreamId = workstreamId;
	}

	start(): void {
		if (this.#unlisten) return;
		this.#unlisten = this.dependencies.subscribe((payload) => this.#handle(payload));
	}

	stop(): void {
		this.#unlisten?.();
		this.#unlisten = null;
		this.#pendingAttentionBySession.clear();
		this.#handledLifecycleKeys.clear();
		this.#handledLifecycleOrder = [];
	}

	flushKnownSessions(): void {
		for (const [sessionId, envelope] of this.#pendingAttentionBySession) {
			if (!this.#routeAttention(envelope)) continue;
			this.#pendingAttentionBySession.delete(sessionId);
		}
	}

	#handle(payload: LiveEventEnvelope): void {
		const envelope = eventEnvelope(payload);
		if (!envelope) return;
		const lifecycleKey = `${envelope.sessionId}\u0000${envelope.runId}\u0000${envelope.seq}\u0000${envelope.event.type}`;
		if (this.#handledLifecycleKeys.has(lifecycleKey)) return;
		this.#handledLifecycleKeys.add(lifecycleKey);
		this.#handledLifecycleOrder.push(lifecycleKey);
		if (this.#handledLifecycleOrder.length > HANDLED_LIFECYCLE_EVENT_LIMIT) {
			const oldest = this.#handledLifecycleOrder.shift();
			if (oldest) this.#handledLifecycleKeys.delete(oldest);
		}
		this.dependencies.applyLifecycle(envelope);

		if (envelope.event.type === 'run.started') {
			this.#pendingAttentionBySession.delete(envelope.sessionId);
			const owner = this.dependencies.sessionFor(envelope.sessionId)?.workstreamId;
			if (owner && owner !== '_unknown') this.dependencies.clearAttention(owner);
			return;
		}

		if (!this.#routeAttention(envelope)) {
			this.#pendingAttentionBySession.set(envelope.sessionId, envelope);
		}
	}

	#routeAttention(envelope: EventEnvelope): boolean {
		const owner = this.dependencies.sessionFor(envelope.sessionId)?.workstreamId;
		if (!owner || owner === '_unknown') return false;
		const context = this.dependencies.contextFor(owner);
		if (!context) return false;
		if (envelope.event.type === 'run.completed' || envelope.event.type === 'run.failed') {
			this.dependencies.clearAttentionForRun(owner, envelope.runId);
		}

		const decision = agentAttentionDecision({
			event: envelope.event,
			runId: envelope.runId,
			sessionId: envelope.sessionId,
			activeWorkstreamId: this.#activeWorkstreamId,
			workstreamId: owner,
			appFocused: this.dependencies.appFocused(),
			queueCount: this.dependencies.queueCountFor(owner),
			workstreamLabel: context.label,
			repositoryFullName: context.repositoryFullName,
			branch: context.branch,
		});
		if (!decision) return true;
		if (this.dependencies.markAttention(owner, decision)) {
			void this.dependencies.notify(decision.title, decision.body, owner, envelope.sessionId);
		}
		return true;
	}
}

export const agentLifecycleMonitor = new AgentLifecycleMonitor({
	subscribe: (listener) => onPlatformEvent(CHAT_AGENT_EVENT_CHANNEL, listener),
	applyLifecycle: (envelope) => sessionsAggregate.applyEvent(envelope),
	sessionFor: (sessionId) => sessionsAggregate.getSession(sessionId),
	appFocused: () => (typeof document === 'undefined' ? true : document.hasFocus()),
	queueCountFor: (workstreamId) => agentPromptQueue.countFor(workstreamId),
	contextFor: (workstreamId) => agentActivity.contextFor(workstreamId),
	clearAttention: (workstreamId) => agentActivity.clear(workstreamId),
	clearAttentionForRun: (workstreamId, runId) => agentActivity.clearForRun(workstreamId, runId),
	markAttention: (workstreamId, attention) => agentActivity.mark(workstreamId, attention),
	notify: (title, body, workstreamId, sessionId) =>
		notificationService.notify(title, body, workstreamId, sessionId),
});
