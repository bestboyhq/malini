import type { ClickedPullRequestAction } from '$lib/pull-requests/domain/deferred-pull-request-action';
import type { MergeConfirmation } from '$lib/pull-requests/domain/merge-confirmation';

type DeferredPullRequestAction = Readonly<{
	workstreamId: string;
	clicked: ClickedPullRequestAction;
	replay(): void;
}>;

type HeldPullRequestAction = DeferredPullRequestAction &
	Readonly<{ token: number; sawActivation: boolean }>;

type ActivationChange = Readonly<{ ready: boolean; failed: boolean; reactivated: boolean }>;

class PullRequestActionStore {
	busy = $state(false);
	busyLabel = $state<string | null>(null);
	mergeRequest = $state.raw<MergeConfirmation | null>(null);
	#revision = 0;
	#deferralToken = 0;
	#deferred: HeldPullRequestAction | null = null;

	get revision(): number {
		return this.#revision;
	}

	holdMergeRequest(request: MergeConfirmation | null): void {
		this.mergeRequest = request;
	}

	claim(busyLabel: string | null = null): number {
		this.#revision += 1;
		this.busy = true;
		this.busyLabel = busyLabel;
		return this.#revision;
	}

	release(revision: number): void {
		if (this.#revision !== revision) return;
		this.busy = false;
		this.busyLabel = null;
	}

	defer(action: DeferredPullRequestAction, sawActivation: boolean): number {
		this.#revision += 1;
		this.#deferralToken += 1;
		this.#deferred = { ...action, token: this.#deferralToken, sawActivation };
		this.busy = true;
		this.busyLabel = null;
		return this.#deferralToken;
	}

	deferredFor(workstreamId: string): DeferredPullRequestAction | null {
		const deferred = this.#deferred;
		return deferred?.workstreamId === workstreamId ? deferred : null;
	}

	takeDeferred(workstreamId: string): DeferredPullRequestAction | null {
		const deferred = this.deferredFor(workstreamId);
		if (!deferred) return null;
		this.#deferred = null;
		this.busy = false;
		return deferred;
	}

	dropDeferred(token?: number): void {
		const deferred = this.#deferred;
		if (!deferred || (token !== undefined && deferred.token !== token)) return;
		this.#deferred = null;
		this.busy = false;
	}

	followActivation(change: ActivationChange): void {
		const deferred = this.#deferred;
		if (!deferred) return;
		if (change.failed || (change.reactivated && deferred.sawActivation)) {
			this.dropDeferred();
			return;
		}
		if (change.ready && !deferred.sawActivation) {
			this.#deferred = { ...deferred, sawActivation: true };
		}
	}

	invalidate(): void {
		this.#revision += 1;
		this.busy = this.#deferred !== null;
		this.busyLabel = null;
		this.mergeRequest = null;
	}

	reset(): void {
		this.#deferred = null;
		this.invalidate();
	}
}

export const pullRequestActionStore = new PullRequestActionStore();
