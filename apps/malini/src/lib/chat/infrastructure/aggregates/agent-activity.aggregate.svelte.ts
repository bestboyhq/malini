import type { AgentAttention, AgentWorkstreamContext } from '$lib/chat/domain/agent-attention';

export class AgentActivity {
	#attentionByWorkstream: Record<string, AgentAttention> = $state({});
	#contextByWorkstream: Record<string, AgentWorkstreamContext> = $state({});

	attentionFor(workstreamId: string): AgentAttention | null {
		return this.#attentionByWorkstream[workstreamId] ?? null;
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
		const previousScopeIds = currentContexts.map((context) => context.workstreamId);
		const next: Record<string, AgentWorkstreamContext> = {};
		const retainedIds = new Set<string>();
		for (const context of normalizedContexts) {
			next[context.workstreamId] = { ...context };
			retainedIds.add(context.workstreamId);
		}
		this.#contextByWorkstream = next;

		const nextAttention = { ...this.#attentionByWorkstream };
		let attentionChanged = false;
		for (const workstreamId of previousScopeIds) {
			if (retainedIds.has(workstreamId)) continue;
			if (!nextAttention[workstreamId]) continue;
			delete nextAttention[workstreamId];
			attentionChanged = true;
		}
		if (attentionChanged) this.#attentionByWorkstream = nextAttention;
		return true;
	}

	mark(workstreamId: string, attention: AgentAttention): boolean {
		if (!workstreamId) return false;
		const existing = this.#attentionByWorkstream[workstreamId];
		if (existing?.runId === attention.runId && existing.kind === attention.kind) return false;
		this.#attentionByWorkstream = {
			...this.#attentionByWorkstream,
			[workstreamId]: attention,
		};
		return true;
	}

	clear(workstreamId: string): boolean {
		if (!this.#attentionByWorkstream[workstreamId]) return false;
		const next = { ...this.#attentionByWorkstream };
		delete next[workstreamId];
		this.#attentionByWorkstream = next;
		return true;
	}

	clearForRun(workstreamId: string, runId: string): boolean {
		const attention = this.#attentionByWorkstream[workstreamId];
		if (attention?.runId !== runId || attention.kind !== 'approval') return false;
		return this.clear(workstreamId);
	}

	reset(): void {
		this.#attentionByWorkstream = {};
		this.#contextByWorkstream = {};
	}
}

export const agentActivity = new AgentActivity();
