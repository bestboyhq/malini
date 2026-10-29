import type { AgentSessionOrigin } from '$contract/agent';
import type { AgentEvent, EventEnvelope } from '$lib/chat/domain/events';
import type { SessionId } from '$lib/chat/domain/session';
import type { LiveEventEnvelope } from '$contract/agent';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';
import { notificationService } from '$shared/system/notification.service';
import { playSignalSoundCommand, type SoundSignal } from '$shared/sounds/sounds.api';
import { agentAttentionDecision, attentionSoundSignal } from '$lib/chat/domain/agent-attention';
import { backgroundWaitOf } from '$lib/chat/domain/background-work';
import { agentActivity } from '../aggregates/agent-activity.aggregate.svelte';
import { agentPromptQueue } from '../aggregates/prompt-queue.aggregate.svelte';
import { sessionsAggregate } from '../aggregates/sessions.aggregate.svelte';

const HANDLED_LIFECYCLE_EVENT_LIMIT = 2_048;

type SessionOwner = {
	workstreamId: string;
	origin?: AgentSessionOrigin;
};

type AgentLifecycleMonitorDependencies = {
	subscribe(listener: (payload: LiveEventEnvelope) => void): () => void;
	applyLifecycle(envelope: EventEnvelope): void;
	sessionFor(sessionId: SessionId): SessionOwner | null;
	appFocused(): boolean;
	queueCountFor(workstreamId: string): number;
	chatIn(workstreamId: string): SessionId | null;
	contextFor: typeof agentActivity.contextFor;
	clearAttention: typeof agentActivity.clearChat;
	clearAttentionForRun: typeof agentActivity.clearForRun;
	markAttention: typeof agentActivity.mark;
	touchChat: typeof agentActivity.touchChat;
	sound(signal: SoundSignal): void;
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
		type === 'run.failed' ||
		type === 'background.updated'
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

function runKey(envelope: EventEnvelope): string {
	return `${envelope.sessionId}\u0000${envelope.runId}`;
}

export class AgentLifecycleMonitor {
	#unlisten: (() => void) | null = null;
	#pendingAttentionBySession = new Map<SessionId, EventEnvelope>();
	#handledLifecycleKeys = new Set<string>();
	#handledLifecycleOrder: string[] = [];
	#announcedSummaryByRun = new Map<string, string>();
	#activeWorkstreamId = '';
	#shownChatId: SessionId | null = null;

	constructor(private readonly dependencies: AgentLifecycleMonitorDependencies) {}

	setShown(workstreamId: string, chatId: SessionId | null): void {
		this.#activeWorkstreamId = workstreamId;
		this.#shownChatId = chatId;
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
		this.#announcedSummaryByRun.clear();
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
		if (envelope.event.type === 'background.updated') {
			const { summary } = envelope.event;
			if (summary === undefined || backgroundWaitOf(envelope.event) !== 'commands') return;
			if (this.#announcedSummaryByRun.get(runKey(envelope)) === summary) return;
			this.#announcedSummaryByRun.set(runKey(envelope), summary);
			this.#attend({
				...envelope,
				event: { type: 'run.completed', runId: envelope.runId, summary },
			});
			return;
		}
		this.dependencies.applyLifecycle(envelope);
		this.dependencies.touchChat(envelope.sessionId, Date.now());

		if (envelope.event.type === 'run.started') {
			this.#pendingAttentionBySession.delete(envelope.sessionId);
			this.dependencies.clearAttention(envelope.sessionId);
			return;
		}

		if (envelope.event.type === 'run.completed' || envelope.event.type === 'run.failed') {
			const announced = this.#announcedSummaryByRun.get(runKey(envelope));
			this.#announcedSummaryByRun.delete(runKey(envelope));
			if (envelope.event.type === 'run.completed' && envelope.event.summary === announced) return;
		}
		this.#attend(envelope);
	}

	#attend(envelope: EventEnvelope): void {
		if (!this.#routeAttention(envelope)) {
			this.#pendingAttentionBySession.set(envelope.sessionId, envelope);
		}
	}

	#routeAttention(envelope: EventEnvelope): boolean {
		const session = this.dependencies.sessionFor(envelope.sessionId);
		const owner = session?.workstreamId;
		if (!owner || owner === '_unknown') return false;
		if (session?.origin === 'job') return true;
		const context = this.dependencies.contextFor(owner);
		if (!context) return false;
		if (envelope.event.type === 'run.completed' || envelope.event.type === 'run.failed') {
			this.dependencies.clearAttentionForRun(envelope.sessionId, envelope.runId);
		}

		const decision = agentAttentionDecision({
			event: envelope.event,
			runId: envelope.runId,
			sessionId: envelope.sessionId,
			queueCount: this.dependencies.queueCountFor(owner),
			workstreamLabel: context.label,
			repositoryFullName: context.repositoryFullName,
			branch: context.branch,
		});
		if (!decision) return true;
		const { lead } = context;
		if (lead && decision.kind !== 'approval') return true;
		this.dependencies.sound(attentionSoundSignal(decision.kind));
		const focused = this.dependencies.appFocused();
		if (focused && envelope.sessionId === this.#shownChatId) return true;
		if (!this.dependencies.markAttention(owner, decision)) return true;
		const notice = lead
			? {
					workstreamId: lead.workstreamId,
					sessionId: this.dependencies.chatIn(lead.workstreamId),
					title: lead.label,
					body: `${decision.title}: ${decision.body}`,
				}
			: {
					workstreamId: owner,
					sessionId: envelope.sessionId,
					title: decision.title,
					body: decision.body,
				};
		const onScreen =
			focused &&
			(owner === this.#activeWorkstreamId || notice.workstreamId === this.#activeWorkstreamId);
		if (notice.sessionId && !onScreen) {
			void this.dependencies.notify(
				notice.title,
				notice.body,
				notice.workstreamId,
				notice.sessionId,
			);
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
	chatIn: (workstreamId) => sessionsAggregate.cachedSessionFor(workstreamId, null),
	contextFor: (workstreamId) => agentActivity.contextFor(workstreamId),
	clearAttention: (sessionId) => agentActivity.clearChat(sessionId),
	clearAttentionForRun: (sessionId, runId) => agentActivity.clearForRun(sessionId, runId),
	markAttention: (workstreamId, attention) => agentActivity.mark(workstreamId, attention),
	touchChat: (sessionId, at) => agentActivity.touchChat(sessionId, at),
	sound: playSignalSoundCommand,
	notify: (title, body, workstreamId, sessionId) =>
		notificationService.notify(title, body, workstreamId, sessionId),
});
