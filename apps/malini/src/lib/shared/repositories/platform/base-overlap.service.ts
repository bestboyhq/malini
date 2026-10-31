import {
	REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL,
	REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL,
	REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL,
} from '$contract/events';
import { isNetworkFailure } from '$contract/github-failure';
import type { MaliniDatabase } from '$main/db/driver';
import { describeError, GitError } from '$main/errors';
import type { EventBus } from '$main/events';
import { baseOverlap, commitOf } from '$main/git/base-overlap';
import { statusCollector } from '$main/git/status';
import type { CheckoutResolver } from './checkout-resolver';
import { getProject } from './projects.repository';
import {
	getWorkstream,
	listWorkstreams,
	mergedPullRequestOf,
	type Workstream,
} from './workstreams.repository';

export const BASE_FETCH_EVERY_MS = 5 * 60_000;

export interface BaseOverlapWatchDeps {
	readonly db: MaliniDatabase;
	readonly events: EventBus;
	readonly checkouts: CheckoutResolver;
	fetchBase(repoPath: string, baseBranch: string): Promise<string>;
	agentWorking(workstreamId: string): Promise<boolean>;
	readonly fetchEveryMs?: number;
	readonly log: (line: string) => void;
}

export class BaseOverlapWatch {
	readonly #deps: BaseOverlapWatchDeps;
	readonly #compared = new Map<string, string>();
	readonly #comparing = new Map<string, Promise<void>>();
	readonly #failingFetches = new Set<string>();
	readonly #unsubscribes: Array<() => void> = [];
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(deps: BaseOverlapWatchDeps) {
		this.#deps = deps;
	}

	start(): void {
		if (this.#timer !== null) return;
		const { events, fetchEveryMs = BASE_FETCH_EVERY_MS } = this.#deps;
		this.#unsubscribes.push(
			events.subscribe(REPOSITORIES_WORKSTREAM_HEAD_MOVED_CHANNEL, ({ workstreamId }) => {
				void this.compare(workstreamId);
			}),
			events.subscribe(REPOSITORIES_WORKSTREAM_REMOVED_CHANNEL, ({ workstreamId }) => {
				this.#compared.delete(workstreamId);
				this.#comparing.delete(workstreamId);
			}),
		);
		this.#timer = setInterval(() => void this.fetchAndCompare(), fetchEveryMs);
		this.#timer.unref();
		void this.fetchAndCompare();
	}

	dispose(): void {
		for (const unsubscribe of this.#unsubscribes.splice(0)) unsubscribe();
		if (this.#timer !== null) clearInterval(this.#timer);
		this.#timer = null;
	}

	async fetchAndCompare(): Promise<void> {
		const byBase = new Map<string, Workstream[]>();
		for (const workstream of listWorkstreams(this.#deps.db)) {
			if (!this.#watched(workstream)) continue;
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
		const comparing = this.#compareAfter(workstreamId, this.#comparing.get(workstreamId));
		this.#comparing.set(workstreamId, comparing);
		return comparing;
	}

	async #compareAfter(workstreamId: string, previous: Promise<void> | undefined): Promise<void> {
		await previous;
		try {
			await this.#compareOnce(workstreamId);
		} catch (error) {
			this.#deps.log(
				`malini: could not compare workstream \`${workstreamId}\` with its base branch: ${describeError(error)}`,
			);
		}
	}

	async #compareOnce(workstreamId: string): Promise<void> {
		const { db, events, checkouts, agentWorking } = this.#deps;
		const workstream = getWorkstream(db, workstreamId);
		if (!workstream || !this.#watched(workstream)) return;
		const checkout = await checkouts.resolveCheckout(workstreamId);
		const [head, baseHead] = await Promise.all([
			commitOf(checkout, 'HEAD'),
			commitOf(checkout, `refs/remotes/origin/${workstream.baseBranch}`),
		]);
		if (head === null || baseHead === null) return;
		const pair = `${head}:${baseHead}`;
		if (this.#compared.get(workstreamId) === pair) return;
		const status = await statusCollector(checkout);
		if (status.dirtyPaths.length > 0 || status.operationInProgress !== null) return;
		if (await agentWorking(workstreamId)) return;
		const overlap = await baseOverlap(checkout, head, baseHead);
		this.#compared.set(workstreamId, pair);
		if (overlap === null) return;
		events.emit(REPOSITORIES_WORKSTREAM_BASE_OVERLAPPED_CHANNEL, {
			workstreamId,
			baseBranch: workstream.baseBranch,
			head,
			baseHead,
			behind: overlap.behind,
			conflicts: overlap.conflictedPaths.length > 0,
			conflictedPaths: [...overlap.conflictedPaths],
			overlappingPaths: [...overlap.overlappingPaths],
		});
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
			if (this.#failingFetches.has(key) || unreachable(error)) return;
			this.#failingFetches.add(key);
			this.#deps.log(
				`malini: could not fetch ${workstream.baseBranch} of ${project.repoPath}: ${describeError(error)}`,
			);
		}
	}
}

function unreachable(error: unknown): boolean {
	return error instanceof GitError && isNetworkFailure(error.detail ?? error.message);
}
