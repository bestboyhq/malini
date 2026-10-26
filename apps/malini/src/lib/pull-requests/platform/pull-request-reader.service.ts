import { PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL } from '$contract/events';
import type { PullRequestStatusDto, ReviewFeedbackDto } from '$contract/repositories';
import type { MainContext } from '$main/context';
import { jsonEqual } from '$main/db/rows';
import { latestLoggedEvent } from '$lib/jobs/jobs.platform';
import {
	needsReviewFeedback,
	pullRequestChange,
	pullRequestReadEvery,
	type PullRequestFacts,
	type ShipDelays,
} from '../domain/shipping';
import type { PullRequestOperations } from './pull-request-operations';
import { getShip } from './ship.repository';
import { shipTarget } from './ship-target';

export type PullRequestRead = Readonly<{ read: boolean; pullRequest: PullRequestFacts | null }>;

const NOT_READ: PullRequestRead = { read: false, pullRequest: null };

export class PullRequestReader {
	readonly #context: MainContext;
	readonly #ops: PullRequestOperations;
	readonly #delays: ShipDelays;
	readonly #now: () => number;
	readonly #gone: (workstreamId: string) => void;
	readonly #reading = new Map<string, Promise<PullRequestRead>>();
	readonly #reads = new Map<string, Readonly<{ at: number; read: PullRequestRead }>>();
	readonly #generations = new Map<string, number>();
	readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
	#disposed = false;

	constructor(
		context: MainContext,
		operations: PullRequestOperations,
		delays: ShipDelays,
		now: () => number,
		gone: (workstreamId: string) => void,
	) {
		this.#context = context;
		this.#ops = operations;
		this.#delays = delays;
		this.#now = now;
		this.#gone = gone;
	}

	read(workstreamId: string, maxAgeMs = 0): Promise<PullRequestRead> {
		const last = this.#reads.get(workstreamId);
		if (last !== undefined && this.#now() - last.at <= maxAgeMs) return Promise.resolve(last.read);
		const running = this.#reading.get(workstreamId);
		if (running) return running;
		const reading: Promise<PullRequestRead> = this.#fetch(workstreamId).finally(() => {
			if (this.#reading.get(workstreamId) === reading) this.#reading.delete(workstreamId);
		});
		this.#reading.set(workstreamId, reading);
		return reading;
	}

	report(workstreamId: string, pullRequest: PullRequestStatusDto): void {
		void this.#record(workstreamId, this.#generation(workstreamId), pullRequest).catch(
			() => undefined,
		);
	}

	forget(workstreamId: string): void {
		this.#reads.delete(workstreamId);
		this.#reading.delete(workstreamId);
		this.#generations.set(workstreamId, (this.#generations.get(workstreamId) ?? 0) + 1);
	}

	watch(workstreamId: string): void {
		this.#clear(workstreamId);
		if (this.#disposed) return;
		const row = getShip(this.#context.db, workstreamId);
		const every = row === null ? null : pullRequestReadEvery(row, this.#delays);
		if (every === null) return;
		const timer = setTimeout(() => {
			this.#timers.delete(workstreamId);
			void this.read(workstreamId)
				.catch(() => NOT_READ)
				.finally(() => this.watch(workstreamId));
		}, every);
		timer.unref();
		this.#timers.set(workstreamId, timer);
	}

	dispose(): void {
		this.#disposed = true;
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
	}

	async #fetch(workstreamId: string): Promise<PullRequestRead> {
		const generation = this.#generation(workstreamId);
		const target = await shipTarget(this.#context.db, workstreamId);
		const pullRequest = await this.#ops.status({
			repoId: target.repoId,
			workstreamId,
			head: target.workstream.branch,
			base: target.base,
			pullRequestNumber: getShip(this.#context.db, workstreamId)?.pullRequestNumber ?? null,
		});
		return this.#record(workstreamId, generation, pullRequest);
	}

	#generation(workstreamId: string): number {
		return this.#generations.get(workstreamId) ?? 0;
	}

	async #record(
		workstreamId: string,
		generation: number,
		pullRequest: PullRequestStatusDto,
	): Promise<PullRequestRead> {
		if (pullRequest.state === 'not_open') {
			this.#gone(workstreamId);
			return this.#remember(workstreamId, generation, { read: true, pullRequest: null });
		}
		const change = pullRequestChange(
			workstreamId,
			pullRequest,
			await this.#feedback(workstreamId, pullRequest),
		);
		if (change === null || this.#disposed) return NOT_READ;
		const { db, events } = this.#context;
		const last = latestLoggedEvent(db, PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL, workstreamId);
		if (last === null || !jsonEqual(last.payload, change)) {
			events.emit(PULL_REQUESTS_PULL_REQUEST_CHANGED_CHANNEL, change);
		}
		return this.#remember(workstreamId, generation, { read: true, pullRequest: change });
	}

	#remember(workstreamId: string, generation: number, read: PullRequestRead): PullRequestRead {
		if (this.#generation(workstreamId) === generation) {
			this.#reads.set(workstreamId, { at: this.#now(), read });
		}
		return read;
	}

	async #feedback(
		workstreamId: string,
		pullRequest: PullRequestStatusDto,
	): Promise<ReviewFeedbackDto | null> {
		if (!needsReviewFeedback(pullRequest) || pullRequest.number === null) return null;
		try {
			const target = await shipTarget(this.#context.db, workstreamId);
			return await this.#ops.reviewFeedback({
				repoId: target.repoId,
				workstreamId,
				pullRequestNumber: pullRequest.number,
			});
		} catch {
			return null;
		}
	}

	#clear(workstreamId: string): void {
		const timer = this.#timers.get(workstreamId);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.#timers.delete(workstreamId);
	}
}
