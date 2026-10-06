import type { AgentRunProfile } from '$shared/providers/providers.api';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { SessionId } from '$lib/chat/domain/session';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import { agentSessions } from '$lib/chat/infrastructure/services/agent-sessions.service';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';
import { defaultAgentModel } from '$shared/providers/providers.api';
import {
	PERFORMANCE_BUDGETS,
	runtimeDiagnostics,
} from '$shared/performance/runtime-diagnostics.svelte';
import { FOREGROUND_ACTIVITY, foregroundActivity } from '$shared/shell/foreground-activity.svelte';

const BRIDGE_HEALTH_POLL_INTERVAL_MS = 2000;
const BRIDGE_HEALTH_DEADLINE_MS = 4_000;

type StartSessionInput = {
	workstreamId: string;
	model?: string;
};

type SendPromptInput = {
	sessionId: SessionId;
	prompt: string;
	clientRequestId?: string;
	contextFiles?: readonly string[];
	attachmentIds?: readonly string[];
	transcriptReferences?: readonly AgentTranscriptReference[];
	elementReferences?: readonly AgentElementReference[];
	profile?: AgentRunProfile;
	automated?: boolean;
};

type RunWatchdogOwner = {
	workstreamId: string;
	sessionId: SessionId | null;
};

async function checkBridgeHealth(): Promise<boolean> {
	try {
		return await agentSessions.healthy();
	} catch {
		return true;
	}
}

export class AgentRunner {
	#modelBySession: Record<SessionId, string | null> = $state({});
	#bridgeDeadOwners = $state<RunWatchdogOwner[]>([]);
	#runOpen = false;
	#activeRunOwner: RunWatchdogOwner | null = null;
	#watchdogGeneration = 0;
	#watchdogTimer: ReturnType<typeof setInterval> | null = null;
	#watchdogPollGeneration: number | null = null;

	async startSession(input: StartSessionInput): Promise<SessionId> {
		const requestedModel = input.model ?? defaultAgentModel();
		const payload = {
			workstreamId: input.workstreamId,
			...(requestedModel === undefined ? {} : { model: requestedModel }),
		};

		const sessionId = await foregroundActivity.track(FOREGROUND_ACTIVITY.startingAgent, () =>
			runtimeDiagnostics.measure(
				{
					category: 'agent',
					label: 'Starting agent session',
					budgetMs: PERFORMANCE_BUDGETS.agentSessionStartMs,
					target: input.workstreamId,
				},
				() => agentSessions.start(payload),
			),
		);
		this.#modelBySession = {
			...this.#modelBySession,
			[sessionId]: requestedModel ?? null,
		};
		return sessionId;
	}

	async sendPrompt(input: SendPromptInput): Promise<string> {
		const runId = await runtimeDiagnostics.measure(
			{
				category: 'agent',
				label: 'Sending prompt',
				budgetMs: PERFORMANCE_BUDGETS.promptAcceptanceMs,
			},
			() =>
				agentSessions.sendPrompt({
					sessionId: input.sessionId,
					prompt: input.prompt,
					...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
					...(input.contextFiles?.length ? { contextFiles: [...input.contextFiles] } : {}),
					...(input.attachmentIds?.length ? { attachmentIds: [...input.attachmentIds] } : {}),
					...(input.transcriptReferences?.length
						? {
								transcriptReferences: input.transcriptReferences.map((reference) => ({
									...reference,
								})),
							}
						: {}),
					...(input.elementReferences?.length
						? {
								elementReferences: input.elementReferences.map((reference) => ({
									...reference,
									rect: { ...reference.rect },
								})),
							}
						: {}),
					...(input.profile ? { profile: { ...input.profile } } : {}),
					...(input.automated === true ? { automated: true } : {}),
				}),
		);
		return runId;
	}

	async cancelRun(sessionId: SessionId): Promise<void> {
		await runtimeDiagnostics.measure(
			{
				category: 'agent',
				label: 'Stopping agent',
				budgetMs: PERFORMANCE_BUDGETS.agentCancellationMs,
			},
			() => agentSessions.cancelRun(sessionId, pendingPromptStore.for(sessionId)?.runId ?? null),
		);
	}

	modelForSession(sessionId: SessionId): string | null | undefined {
		if (!Object.prototype.hasOwnProperty.call(this.#modelBySession, sessionId)) {
			return undefined;
		}
		return this.#modelBySession[sessionId];
	}

	get bridgeDead(): boolean {
		return this.#bridgeDeadOwners.length > 0;
	}

	bridgeDeadFor(owner: RunWatchdogOwner): boolean {
		return this.#bridgeDeadOwners.some((candidate) => sameWatchdogOwner(candidate, owner));
	}

	setRunOpen(
		open: boolean,
		owner: RunWatchdogOwner = { workstreamId: '_unknown', sessionId: null },
	): void {
		const nextOwner = open ? owner : null;
		if (this.#runOpen === open && sameWatchdogOwner(this.#activeRunOwner, nextOwner)) return;
		this.#watchdogGeneration += 1;
		this.#runOpen = open;
		this.#activeRunOwner = nextOwner;
		if (open) {
			this.#startWatchdog();
		} else {
			this.#stopWatchdog();
		}
	}

	clearBridgeDead(owner?: RunWatchdogOwner): void {
		if (!owner) {
			this.#bridgeDeadOwners = [];
			return;
		}
		this.#bridgeDeadOwners = this.#bridgeDeadOwners.filter(
			(candidate) => !sameWatchdogOwner(candidate, owner),
		);
	}

	#startWatchdog(): void {
		if (this.#watchdogTimer) return;
		this.#watchdogTimer = setInterval(() => {
			void this.#pollBridgeHealth();
		}, BRIDGE_HEALTH_POLL_INTERVAL_MS);
	}

	#stopWatchdog(): void {
		if (this.#watchdogTimer) {
			clearInterval(this.#watchdogTimer);
			this.#watchdogTimer = null;
		}
	}

	async #pollBridgeHealth(): Promise<void> {
		const generation = this.#watchdogGeneration;
		const owner = this.#activeRunOwner;
		if (
			!this.#runOpen ||
			!owner ||
			this.bridgeDeadFor(owner) ||
			this.#watchdogPollGeneration === generation
		) {
			return;
		}
		this.#watchdogPollGeneration = generation;
		let deadline: ReturnType<typeof setTimeout> | null = null;
		try {
			const result = await Promise.race([
				checkBridgeHealth(),
				new Promise<'deadline'>((resolve) => {
					deadline = setTimeout(() => resolve('deadline'), BRIDGE_HEALTH_DEADLINE_MS);
				}),
			]);
			if (
				this.#runOpen &&
				this.#watchdogGeneration === generation &&
				sameWatchdogOwner(this.#activeRunOwner, owner) &&
				(result === 'deadline' || result === false)
			) {
				if (!this.bridgeDeadFor(owner)) {
					this.#bridgeDeadOwners = [...this.#bridgeDeadOwners, { ...owner }];
				}
			}
		} catch {
		} finally {
			if (deadline) clearTimeout(deadline);
			if (this.#watchdogPollGeneration === generation) {
				this.#watchdogPollGeneration = null;
			}
		}
	}

	__resetForTests(): void {
		this.#stopWatchdog();
		this.#watchdogGeneration += 1;
		this.#runOpen = false;
		this.#activeRunOwner = null;
		this.#watchdogPollGeneration = null;
		this.#bridgeDeadOwners = [];
		this.#modelBySession = {};
	}

	__setModelForTests(sessionId: SessionId, model: string | null): void {
		this.#modelBySession = {
			...this.#modelBySession,
			[sessionId]: model,
		};
	}
}

export const agentRunner = new AgentRunner();

function sameWatchdogOwner(left: RunWatchdogOwner | null, right: RunWatchdogOwner | null): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.workstreamId === right.workstreamId &&
			left.sessionId === right.sessionId)
	);
}
