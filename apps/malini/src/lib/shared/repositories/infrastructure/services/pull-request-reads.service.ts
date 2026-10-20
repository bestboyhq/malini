import type { PullRequestStatusDto } from '$contract/repositories';

type PullRequestReadKey = Readonly<{
	workstreamId: string;
	head: string;
	base: string;
	pullRequestNumber: number | null;
}>;

type SettledRead = Readonly<{
	key: PullRequestReadKey;
	startedAt: number;
	status: PullRequestStatusDto;
}>;

type PendingRead = Readonly<{
	key: PullRequestReadKey;
	claim: object;
	promise: Promise<PullRequestStatusDto>;
}>;

type ReadPullRequest = () => Promise<PullRequestStatusDto>;

export class PullRequestReads {
	readonly #now: () => number;
	readonly #settled = new Map<string, SettledRead>();
	readonly #pending = new Map<string, PendingRead>();
	readonly #generations = new Map<string, number>();

	constructor(now: () => number) {
		this.#now = now;
	}

	read(
		key: PullRequestReadKey,
		maxAgeMs: number | undefined,
		readPullRequest: ReadPullRequest,
	): Promise<PullRequestStatusDto> {
		const settled = this.#reusable(key, maxAgeMs);
		if (settled) return Promise.resolve(settled);
		const exact = this.#pending.get(readKeyId(key));
		if (exact) return exact.promise;
		const byHead = key.pullRequestNumber === null ? undefined : this.#pending.get(headKeyId(key));
		if (byHead) return this.#readThrough(key, byHead, readPullRequest);
		return this.#start(key, readPullRequest);
	}

	forget(workstreamId: string): void {
		this.#generations.set(workstreamId, this.#generation(workstreamId) + 1);
		for (const [id, read] of this.#settled) {
			if (read.key.workstreamId === workstreamId) this.#settled.delete(id);
		}
		for (const [id, read] of this.#pending) {
			if (read.key.workstreamId === workstreamId) this.#pending.delete(id);
		}
	}

	#reusable(key: PullRequestReadKey, maxAgeMs: number | undefined): PullRequestStatusDto | null {
		if (maxAgeMs === undefined || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return null;
		const oldest = this.#now() - maxAgeMs;
		const exact = this.#settled.get(readKeyId(key));
		if (exact && exact.startedAt >= oldest) return exact.status;
		if (key.pullRequestNumber === null) return null;
		const byHead = this.#settled.get(headKeyId(key));
		return byHead && byHead.startedAt >= oldest && byHead.status.number === key.pullRequestNumber
			? byHead.status
			: null;
	}

	async #readThrough(
		key: PullRequestReadKey,
		byHead: PendingRead,
		readPullRequest: ReadPullRequest,
	): Promise<PullRequestStatusDto> {
		const shared = await settledOrNull(byHead.promise);
		if (shared && shared.number === key.pullRequestNumber) return shared;
		return this.#pending.get(readKeyId(key))?.promise ?? this.#start(key, readPullRequest);
	}

	#start(key: PullRequestReadKey, readPullRequest: ReadPullRequest): Promise<PullRequestStatusDto> {
		const id = readKeyId(key);
		const claim = {};
		const promise = this.#settle(id, key, claim, readPullRequest);
		this.#pending.set(id, { key, claim, promise });
		return promise;
	}

	async #settle(
		id: string,
		key: PullRequestReadKey,
		claim: object,
		readPullRequest: ReadPullRequest,
	): Promise<PullRequestStatusDto> {
		const generation = this.#generation(key.workstreamId);
		const startedAt = this.#now();
		try {
			const status = await readPullRequest();
			if (this.#generation(key.workstreamId) === generation) {
				this.#remember(id, { key, startedAt, status });
			}
			return status;
		} finally {
			if (this.#pending.get(id)?.claim === claim) this.#pending.delete(id);
		}
	}

	#remember(id: string, read: SettledRead): void {
		for (const [otherId, other] of this.#settled) {
			if (
				other.key.workstreamId === read.key.workstreamId &&
				headKeyId(other.key) !== headKeyId(read.key)
			) {
				this.#settled.delete(otherId);
			}
		}
		this.#settled.set(id, read);
	}

	#generation(workstreamId: string): number {
		return this.#generations.get(workstreamId) ?? 0;
	}
}

function readKeyId(key: PullRequestReadKey): string {
	return JSON.stringify([key.workstreamId, key.head, key.base, key.pullRequestNumber]);
}

function headKeyId(key: PullRequestReadKey): string {
	return readKeyId({ ...key, pullRequestNumber: null });
}

async function settledOrNull(
	promise: Promise<PullRequestStatusDto>,
): Promise<PullRequestStatusDto | null> {
	try {
		return await promise;
	} catch {
		return null;
	}
}
