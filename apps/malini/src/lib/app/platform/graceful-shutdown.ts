import type { ShutdownImpact, ShutdownOutcome } from '$contract/system';
import type { MaliniDatabase } from '$main/db/driver';
import type { DockerOwnership } from '$main/docker/ownership';
import {
	reclaimContainers,
	recordUnfinishedTeardown,
	type ContainerReaper,
} from '$main/docker/reclaim';
import { describeError } from '$main/errors';

export const SHUTDOWN_BUDGET_MS = 20_000;

const SHUTDOWN_IMPACT_KEYS = ['agentRuns', 'containers'] as const;

export type ShutdownImpactSources = { [K in keyof ShutdownImpact]: () => number };

export function emptyShutdownImpact(): ShutdownImpact {
	return {
		agentRuns: 0,
		containers: 0,
	};
}

export function shutdownImpactIsEmpty(impact: ShutdownImpact): boolean {
	return Object.values(impact).every((count) => count === 0);
}

export function readShutdownImpact(sources: Partial<ShutdownImpactSources>): ShutdownImpact {
	const impact = emptyShutdownImpact();
	for (const key of SHUTDOWN_IMPACT_KEYS) {
		const source = sources[key];
		if (!source) continue;
		try {
			impact[key] = Math.max(0, Math.trunc(source()));
		} catch {
			impact[key] = 0;
		}
	}
	return impact;
}

export function openAgentRunCount(db: MaliniDatabase): number {
	try {
		const row: unknown = db
			.prepare('SELECT COUNT(*) AS count FROM agent_runs WHERE completed_at IS NULL')
			.get();
		const count = typeof row === 'object' && row !== null && 'count' in row ? row.count : 0;
		return Math.max(0, Number(count));
	} catch {
		return 0;
	}
}

export interface ShutdownChildren {
	cancelAgentRuns(): Promise<number> | number;
}

export interface ConfirmedShutdownDeps {
	readonly db: MaliniDatabase;
	readonly ownership: DockerOwnership;
	readonly reaper: ContainerReaper;
	readonly children: ShutdownChildren;
	readonly ownerIsAlive: (pid: number) => boolean;
}

export class ConfirmedShutdown {
	private reclaimDone = false;

	constructor(private readonly deps: ConfirmedShutdownDeps) {}

	get alreadyReclaimed(): boolean {
		return this.reclaimDone;
	}

	async run(budgetMs: number = SHUTDOWN_BUDGET_MS): Promise<ShutdownOutcome> {
		const started = Date.now();
		const deadline = started + budgetMs;
		const outcome: ShutdownOutcome = {
			containersRemoved: [],
			containersUnfinished: [],
			networksRemoved: [],
			agentRunsClosed: 0,
			timedOut: false,
			alreadyReclaimed: false,
			durationMs: 0,
			errors: [],
		};
		const { children } = this.deps;
		if (this.reclaimDone) {
			outcome.alreadyReclaimed = true;
			outcome.durationMs = Date.now() - started;
			return outcome;
		}
		this.reclaimDone = true;

		await this.#reclaimStartedContainers(outcome, deadline);

		try {
			outcome.agentRunsClosed = await children.cancelAgentRuns();
		} catch (error) {
			outcome.errors.push(`could not close open agent runs: ${describeError(error)}`);
		}

		outcome.timedOut ||= Date.now() >= deadline;
		outcome.durationMs = Date.now() - started;
		return outcome;
	}

	async #reclaimStartedContainers(outcome: ShutdownOutcome, deadline: number): Promise<void> {
		const { db, ownership, reaper, ownerIsAlive } = this.deps;
		if (ownership.ownedContainerCount() === 0) return;
		try {
			const reclaim = await reclaimContainers(
				db,
				ownership,
				'started-by-this-run',
				reaper,
				deadline,
				ownerIsAlive,
			);
			outcome.timedOut ||= reclaim.timedOut;
			outcome.containersRemoved = [...reclaim.removed];
			outcome.containersUnfinished = [...reclaim.unfinished];
			outcome.networksRemoved = [...reclaim.networksRemoved];
			recordUnfinishedTeardown(db, 'quit', reclaim);
		} catch (error) {
			outcome.errors.push(`could not enumerate owned containers: ${describeError(error)}`);
		}
	}
}
