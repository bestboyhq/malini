import type { ShutdownImpact, ShutdownOutcome } from '$contract/system';

class CloseConfirmationStore {
	open = $state(false);
	impact = $state.raw<ShutdownImpact | null>(null);
	impactFailed = $state(false);
	closing = $state(false);
	destroyFailed = $state(false);
	outcome = $state.raw<ShutdownOutcome | null>(null);

	beginRequest(): void {
		this.open = true;
		this.impact = null;
		this.impactFailed = false;
		this.destroyFailed = false;
		this.outcome = null;
	}

	setImpact(impact: ShutdownImpact): void {
		this.impact = impact;
	}

	failImpact(): void {
		this.impactFailed = true;
	}

	dismiss(): void {
		this.open = false;
	}

	beginClosing(): void {
		this.closing = true;
		this.destroyFailed = false;
	}

	failClosing(): void {
		this.closing = false;
		this.destroyFailed = true;
	}

	setOutcome(outcome: ShutdownOutcome | null): void {
		this.outcome = outcome;
	}
}

export const closeConfirmationStore = new CloseConfirmationStore();
