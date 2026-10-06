import type { WorkstreamBaseSyncOutcome } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import type { GitCredentialEnv } from '$main/git/credentials';
import { fastForwardCheckout, recordedRemoteBase, syncRemoteBase } from '$main/git/remote';
import { UNKNOWN_WORKSTREAM_REPOSITORY, type CheckoutResolver } from './checkout-resolver';
import { getProject } from './projects.repository';
import { getWorkstream } from './workstreams.repository';

export interface BaseSyncDeps {
	readonly db: MaliniDatabase;
	readonly credentials: GitCredentialEnv;
	readonly checkouts: CheckoutResolver;
}

interface InFlightSync {
	cancelled: boolean;
	fastForward: Promise<WorkstreamBaseSyncOutcome> | null;
}

interface RunningSync {
	readonly entry: InFlightSync;
	readonly outcome: Promise<WorkstreamBaseSyncOutcome>;
}

export class WorkstreamBaseSync {
	readonly #fetches = new Map<string, Promise<string>>();
	readonly #syncs = new Map<string, RunningSync>();
	readonly #tearingDown = new Set<string>();
	readonly #fetchedAtCreation = new Set<string>();

	constructor(private readonly deps: BaseSyncDeps) {}

	async startRef(
		repoPath: string,
		baseBranch: string,
		githubToken: string | null,
	): Promise<{ readonly ref: string; readonly fetched: boolean }> {
		const recorded = await recordedRemoteBase(repoPath, baseBranch);
		if (recorded) return { ref: recorded, fetched: false };
		return { ref: await this.#fetch(repoPath, baseBranch, githubToken), fetched: true };
	}

	rememberFetchedAtCreation(workstreamId: string): void {
		this.#fetchedAtCreation.add(workstreamId);
	}

	sync(workstreamId: string): Promise<WorkstreamBaseSyncOutcome> {
		if (this.#tearingDown.has(workstreamId)) return Promise.resolve('cancelled');
		if (this.#fetchedAtCreation.delete(workstreamId)) return Promise.resolve('current');
		const running = this.#syncs.get(workstreamId);
		if (running) return running.outcome;
		const entry: InFlightSync = { cancelled: false, fastForward: null };
		const outcome = this.#syncOnce(workstreamId, entry);
		this.#syncs.set(workstreamId, { entry, outcome });
		return outcome;
	}

	async whileTearingDown<T>(workstreamId: string, teardown: () => Promise<T>): Promise<T> {
		this.#tearingDown.add(workstreamId);
		this.#fetchedAtCreation.delete(workstreamId);
		try {
			const running = this.#syncs.get(workstreamId);
			if (running) {
				running.entry.cancelled = true;
				await settledQuietly(running.entry.fastForward);
			}
			return await teardown();
		} finally {
			this.#tearingDown.delete(workstreamId);
		}
	}

	async #syncOnce(workstreamId: string, entry: InFlightSync): Promise<WorkstreamBaseSyncOutcome> {
		try {
			const checkout = await this.deps.checkouts.resolveCheckout(workstreamId);
			const workstream = getWorkstream(this.deps.db, workstreamId);
			const project = workstream ? getProject(this.deps.db, workstream.projectId) : null;
			if (!workstream || !project) {
				throw new Error(`${UNKNOWN_WORKSTREAM_REPOSITORY}: ${workstreamId}`);
			}
			const remoteRef = await this.#fetch(project.repoPath, workstream.baseBranch, null);
			if (entry.cancelled) return 'cancelled';
			entry.fastForward = fastForwardCheckout(checkout, remoteRef);
			return await entry.fastForward;
		} finally {
			if (this.#syncs.get(workstreamId)?.entry === entry) this.#syncs.delete(workstreamId);
		}
	}

	#fetch(repoPath: string, baseBranch: string, githubToken: string | null): Promise<string> {
		const key = `${repoPath}\u0000${baseBranch}`;
		const running = this.#fetches.get(key);
		if (running) return running;
		const fetching = this.#fetchOnce(key, repoPath, baseBranch, githubToken);
		this.#fetches.set(key, fetching);
		return fetching;
	}

	async #fetchOnce(
		key: string,
		repoPath: string,
		baseBranch: string,
		githubToken: string | null,
	): Promise<string> {
		try {
			return await syncRemoteBase(repoPath, baseBranch, githubToken, this.deps.credentials);
		} finally {
			this.#fetches.delete(key);
		}
	}
}

async function settledQuietly(promise: Promise<unknown> | null): Promise<void> {
	try {
		await promise;
	} catch {}
}
