import {
	PULL_REQUESTS_SHIP_CHANGED_CHANNEL,
	REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import { isNetworkFailure } from '$contract/github-failure';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError, GitError } from '$main/errors';
import type { EventBus } from '$main/events';
import { baseOverlap, branchStart, commitOf } from '$main/git/base-overlap';
import { statusCollector } from '$main/git/status';
import type { CheckoutResolver } from './checkout-resolver';
import { getProject } from './projects.repository';
import {
	getWorkstream,
	listWorkstreams,
	mergedPullRequestOf,
	workstreamActiveTimes,
	type Workstream,
} from './workstreams.repository';

export const BASE_FETCH_EVERY_MS = 5 * 60_000;
export const BASE_QUIET_MS = 30_000;
export const ACTIVE_WITHIN_MS = 7 * 24 * 60 * 60_000;
const STALE = ':stale';

export interface BaseOverlapWatchDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	readonly checkouts: CheckoutResolver;
	fetchBase(repoPath: string, baseBranch: string): Promise<string>;
	busy(workstreamId: string): Promise<boolean>;
	merging(workstreamId: string): Promise<boolean>;
	pullRequestEnded(workstream: Workstream): Promise<boolean>;
	fastForward(workstreamId: string, checkout: string, baseRef: string): Promise<unknown>;
	readonly fetchEveryMs?: number;
	readonly quietMs?: number;
	readonly now?: () => number;
	readonly log: (line: string) => void;
}

export class BaseOverlapWatch {
	readonly #deps: BaseOverlapWatchDeps;
	readonly #compared = new Map<string, string>();
	readonly #comparing = new Map<string, Promise<void>>();
	readonly #bases = new Map<string, Readonly<{ baseHead: string; movedAt: number }>>();
	readonly #quiet = new Map<string, ReturnType<typeof setTimeout>>();
	readonly #failingFetches = new Set<string>();
	readonly #unsubscribes: Array<() => void> = [];
	#timer: ReturnType<typeof setInterval> | null = null;
	#disposed = false;

	constructor(deps: BaseOverlapWatchDeps) {
		this.#deps = deps;
	}

	start(): void {
		if (this.#timer !== null) return;
		this.#disposed = false;
		const { events, fetchEveryMs = BASE_FETCH_EVERY_MS } = this.#deps;
		this.#unsubscribes.push(
			events.subscribe(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL, ({ workstreamId }) => {
				void this.compare(workstreamId);
			}),
			events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, ({ workstreamId }) => {
				this.#compared.delete(workstreamId);
				this.#comparing.delete(workstreamId);
				this.#bases.delete(workstreamId);
				clearTimeout(this.#quiet.get(workstreamId));
				this.#quiet.delete(workstreamId);
			}),
			events.subscribe(PULL_REQUESTS_SHIP_CHANGED_CHANNEL, ({ workstreamId, merged }) => {
				const landed = merged ? getWorkstream(this.#deps.db, workstreamId) : null;
				if (landed) void this.fetchAndCompare(landed);
			}),
		);
		this.#timer = setInterval(() => void this.fetchAndCompare(), fetchEveryMs);
		this.#timer.unref();
		void this.fetchAndCompare();
	}

	dispose(): void {
		this.#disposed = true;
		for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
		if (this.#timer !== null) clearInterval(this.#timer);
		this.#timer = null;
		for (const timer of this.#quiet.values()) clearTimeout(timer);
		this.#quiet.clear();
	}

	async fetchAndCompare(
		landed: Pick<Workstream, 'projectId' | 'baseBranch'> | null = null,
	): Promise<void> {
		const byBase = new Map<string, Workstream[]>();
		for (const workstream of listWorkstreams(this.#deps.db)) {
			if (!this.#watched(workstream)) continue;
			if (landed && !sameBase(workstream, landed)) continue;
			const key = `${workstream.projectId}\u0000${workstream.baseBranch}`;
			byBase.set(key, [...(byBase.get(key) ?? []), workstream]);
		}
		await Promise.all(
			[...byBase].map(async ([key, workstreams]) => {
				const [first] = workstreams;
				if (first) await this.#fetch(key, first);
				await Promise.all(workstreams.map((workstream) => this.compare(workstream.id)));
			}),
		);
	}

	compare(workstreamId: string): Promise<void> {
		if (this.#disposed) return Promise.resolve();
		const comparing = this.#compareAfter(workstreamId, this.#comparing.get(workstreamId));
		this.#comparing.set(workstreamId, comparing);
		return comparing;
	}

	async #compareAfter(workstreamId: string, previous: Promise<void> | undefined): Promise<void> {
		await previous;
		try {
			await this.#compareOnce(workstreamId);
		} catch (error) {
			if (this.#disposed) return;
			this.#deps.log(
				`malini: could not compare workstream \`${workstreamId}\` with its base branch: ${describeError(error)}`,
			);
		}
	}

	async #compareOnce(workstreamId: string): Promise<void> {
		const { db, events, checkouts, busy, merging, pullRequestEnded } = this.#deps;
		const workstream = getWorkstream(db, workstreamId);
		if (!workstream || !this.#watched(workstream)) return;
		const checkout = await checkouts.resolveCheckout(workstreamId);
		const baseRef = `refs/remotes/origin/${workstream.baseBranch}`;
		const [head, baseHead] = await Promise.all([
			commitOf(checkout, 'HEAD'),
			commitOf(checkout, baseRef),
		]);
		if (head === null || baseHead === null) return;
		const pair = `${head}:${baseHead}`;
		const active = this.#active(workstream);
		const compared = this.#compared.get(workstreamId);
		if (compared === pair || (compared === `${pair}${STALE}` && !active)) return;
		if (this.#settling(workstreamId, baseHead)) return;
		const status = await statusCollector(checkout);
		if (status.dirtyPaths.length > 0 || status.operationInProgress !== null) return;
		if ((await busy(workstreamId)) || (await merging(workstreamId))) return;
		const overlap = await baseOverlap(checkout, head, baseHead);
		if (overlap?.pristine) {
			if (await startedFromBase(checkout, workstream)) {
				await this.#deps.fastForward(workstreamId, checkout, baseRef);
			}
			this.#compared.set(workstreamId, pair);
			return;
		}
		const overlapping = (overlap?.overlappingPaths.length ?? 0) > 0;
		const fires = overlap !== null && (overlapping || active);
		const ended = fires && (await pullRequestEnded(workstream));
		this.#compared.set(workstreamId, overlap !== null && !fires ? `${pair}${STALE}` : pair);
		if (overlap === null || !fires || ended || this.#disposed) return;
		events.emit(REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL, {
			workstreamId,
			baseBranch: workstream.baseBranch,
			head,
			baseHead,
			behind: overlap.behind,
			overlapping,
			conflicts: overlap.conflictedPaths.length > 0,
			conflictedPaths: [...overlap.conflictedPaths],
			overlappingPaths: [...overlap.overlappingPaths],
		});
	}

	#active(workstream: Workstream): boolean {
		const activeAt =
			workstreamActiveTimes(this.#deps.db).get(workstream.id) ?? workstream.createdAt;
		return Date.parse(activeAt) >= this.#now() - ACTIVE_WITHIN_MS;
	}

	#settling(workstreamId: string, baseHead: string): boolean {
		const seen = this.#bases.get(workstreamId);
		const now = this.#now();
		const movedAt = seen === undefined ? 0 : seen.baseHead === baseHead ? seen.movedAt : now;
		this.#bases.set(workstreamId, { baseHead, movedAt });
		const waitMs = movedAt + (this.#deps.quietMs ?? BASE_QUIET_MS) - now;
		if (waitMs <= 0) return false;
		clearTimeout(this.#quiet.get(workstreamId));
		const timer = setTimeout(() => {
			this.#quiet.delete(workstreamId);
			void this.compare(workstreamId);
		}, waitMs);
		timer.unref();
		this.#quiet.set(workstreamId, timer);
		return true;
	}

	#now(): number {
		return (this.#deps.now ?? Date.now)();
	}

	#watched(workstream: Workstream): boolean {
		return (
			workstream.status === 'active' &&
			workstream.scope === null &&
			workstream.baseBranch.length > 0 &&
			mergedPullRequestOf(this.#deps.db, workstream.id) === null
		);
	}

	async #fetch(key: string, workstream: Workstream): Promise<void> {
		const project = getProject(this.#deps.db, workstream.projectId);
		if (!project) return;
		try {
			await this.#deps.fetchBase(project.repoPath, workstream.baseBranch);
			this.#failingFetches.delete(key);
		} catch (error) {
			if (this.#disposed || this.#failingFetches.has(key) || unreachable(error)) return;
			this.#failingFetches.add(key);
			this.#deps.log(
				`malini: could not fetch ${workstream.baseBranch} of ${project.repoPath}: ${describeError(error)}`,
			);
		}
	}
}

function sameBase(
	workstream: Workstream,
	base: Pick<Workstream, 'projectId' | 'baseBranch'>,
): boolean {
	return workstream.projectId === base.projectId && workstream.baseBranch === base.baseBranch;
}

async function startedFromBase(checkout: string, workstream: Workstream): Promise<boolean> {
	const start = await branchStart(checkout, workstream.branch);
	return (
		start === `origin/${workstream.baseBranch}` ||
		start === `refs/remotes/origin/${workstream.baseBranch}`
	);
}

function unreachable(error: unknown): boolean {
	return error instanceof GitError && isNetworkFailure(error.detail ?? error.message);
}
