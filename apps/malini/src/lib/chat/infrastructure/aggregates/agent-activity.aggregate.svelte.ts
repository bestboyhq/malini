import {
	mostPressingAttention,
	type AgentAttention,
	type AgentWorkstreamContext,
} from '$lib/chat/domain/agent-attention';

type ChatAttention = AgentAttention & Readonly<{ workstreamId: string }>;

export class AgentActivity {
	#attentionByChat: Record<string, ChatAttention> = $state({});
	#contextByWorkstream: Record<string, AgentWorkstreamContext> = $state({});
	#activeAtByChat: Record<string, number> = $state({});

	attentionFor(workstreamId: string): AgentAttention | null {
		return mostPressingAttention(this.#chatsIn(workstreamId));
	}

	activeAtForChat(sessionId: string): number | null {
		return this.#activeAtByChat[sessionId] ?? null;
	}

	touchChat(sessionId: string, at: number): void {
		this.#activeAtByChat = { ...this.#activeAtByChat, [sessionId]: at };
	}

	attentionForChat(sessionId: string): AgentAttention | null {
		return this.#attentionByChat[sessionId] ?? null;
	}

	unreadChatsIn(workstreamId: string): readonly string[] {
		return this.#chatsIn(workstreamId).map(({ sessionId }) => sessionId);
	}

	contextFor(workstreamId: string): AgentWorkstreamContext | null {
		return this.#contextByWorkstream[workstreamId] ?? null;
	}

	workstreamIds(): readonly string[] {
		return Object.values(this.#contextByWorkstream).map((context) => context.workstreamId);
	}

	registerWorkstreamScope(contexts: readonly AgentWorkstreamContext[]): boolean {
		const normalizedContexts = [
			...new Map(
				contexts
					.filter((context) => context.workstreamId)
					.map((context) => [context.workstreamId, context]),
			).values(),
		];
		const currentContexts = Object.values(this.#contextByWorkstream);
		const scopeUnchanged =
			currentContexts.length === normalizedContexts.length &&
			normalizedContexts.every((context) => {
				const current = this.#contextByWorkstream[context.workstreamId];
				return (
					current?.label === context.label &&
					current.repositoryFullName === context.repositoryFullName &&
					current.branch === context.branch
				);
			});
		if (scopeUnchanged) return false;
		const next: Record<string, AgentWorkstreamContext> = {};
		for (const context of normalizedContexts) next[context.workstreamId] = { ...context };
		const previousScopeIds = new Set(currentContexts.map((context) => context.workstreamId));
		this.#contextByWorkstream = next;

		const retained = Object.entries(this.#attentionByChat).filter(
			([, attention]) =>
				!previousScopeIds.has(attention.workstreamId) || attention.workstreamId in next,
		);
		if (retained.length !== Object.keys(this.#attentionByChat).length) {
			this.#attentionByChat = Object.fromEntries(retained);
		}
		return true;
	}

	mark(workstreamId: string, attention: AgentAttention): boolean {
		if (!workstreamId || !attention.sessionId) return false;
		const existing = this.#attentionByChat[attention.sessionId];
		if (existing?.runId === attention.runId && existing.kind === attention.kind) return false;
		this.#attentionByChat = {
			...this.#attentionByChat,
			[attention.sessionId]: { ...attention, workstreamId },
		};
		return true;
	}

	clearChat(sessionId: string): boolean {
		if (!this.#attentionByChat[sessionId]) return false;
		const next = { ...this.#attentionByChat };
		delete next[sessionId];
		this.#attentionByChat = next;
		return true;
	}

	clearForRun(sessionId: string, runId: string): boolean {
		const attention = this.#attentionByChat[sessionId];
		if (attention?.runId !== runId || attention.kind !== 'approval') return false;
		return this.clearChat(sessionId);
	}

	reset(): void {
		this.#attentionByChat = {};
		this.#activeAtByChat = {};
		this.#contextByWorkstream = {};
	}

	#chatsIn(workstreamId: string): readonly ChatAttention[] {
		return Object.values(this.#attentionByChat).filter(
			(attention) => attention.workstreamId === workstreamId,
		);
	}
}

export const agentActivity = new AgentActivity();
