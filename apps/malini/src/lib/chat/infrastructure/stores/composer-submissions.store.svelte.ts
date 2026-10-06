import type { ComposerSubmissionRecoverySnapshot } from '$lib/chat/domain/composer-submission-recovery';
import { SerialSubmissionQueue } from '$lib/chat/domain/serial-submission-queue';
import { FreshSubmissionIntentLatch } from '$lib/chat/domain/submission-session-target';

type ComposerDelivery = Readonly<{
	deliver(): Promise<void>;
	whenIdle(): void;
}>;

class ComposerSubmissionsStore {
	pending: number = $state(0);
	restorations: Record<string, number> = $state({});
	#failures = new Map<string, ComposerSubmissionRecoverySnapshot[]>();
	#freshIntent = new FreshSubmissionIntentLatch();
	#idleListener: (() => void) | null = null;
	#queue = new SerialSubmissionQueue<ComposerDelivery>({
		consume: (delivery) => delivery.deliver(),
		onPendingChange: (count) => {
			this.pending = count;
			if (count === 0) this.#idleListener?.();
		},
	});

	enqueue(delivery: ComposerDelivery): void {
		this.#idleListener = delivery.whenIdle;
		this.#queue.enqueue(delivery);
	}

	claimFreshIntent(requested: boolean, key: string): boolean {
		return this.#freshIntent.claim(requested, key);
	}

	resetFreshIntent(): void {
		this.#freshIntent.reset();
	}

	rememberFailure(draftScope: string, snapshot: ComposerSubmissionRecoverySnapshot): void {
		this.#failures.set(draftScope, [...(this.#failures.get(draftScope) ?? []), snapshot]);
	}

	takeFailures(): ReadonlyMap<string, readonly ComposerSubmissionRecoverySnapshot[]> {
		const failures = new Map(this.#failures);
		this.#failures.clear();
		return failures;
	}

	markRestored(draftScope: string): void {
		this.restorations = {
			...this.restorations,
			[draftScope]: (this.restorations[draftScope] ?? 0) + 1,
		};
	}

	reset(): void {
		this.#failures.clear();
		this.#freshIntent.reset();
		this.restorations = {};
	}
}

export const composerSubmissionsStore = new ComposerSubmissionsStore();
