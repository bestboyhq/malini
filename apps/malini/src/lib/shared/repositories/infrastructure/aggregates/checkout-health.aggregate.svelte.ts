import type { CheckoutHealth } from '$contract/repositories';
import { provisioningClonePercent } from '$shared/repositories/domain/provisioning';
import { checkoutHealthService } from '$shared/repositories/infrastructure/services/checkout-health.service';

const HEALTHY: CheckoutHealth = {
	state: 'healthy',
	finding: null,
	repairable: false,
	said: null,
	restored: null,
};

class CheckoutHealthAggregate {
	byWorkstream: Readonly<Record<string, CheckoutHealth>> = $state.raw({});
	clonePercents: Readonly<Record<string, number>> = $state.raw({});

	#revisions = new Map<string, number>();

	healthOf(workstreamId: string): CheckoutHealth {
		return this.byWorkstream[workstreamId] ?? HEALTHY;
	}

	clonePercentOf(workstreamId: string): number | null {
		return this.clonePercents[workstreamId] ?? null;
	}

	reportClone(workstreamId: string, fraction: number): void {
		if (this.healthOf(workstreamId).state !== 'repairing') return;
		const percent = provisioningClonePercent(fraction);
		if (this.clonePercents[workstreamId] === percent) return;
		this.clonePercents = { ...this.clonePercents, [workstreamId]: percent };
	}

	readable(workstreamId: string): boolean {
		return this.healthOf(workstreamId).state === 'healthy';
	}

	follow(healed: (workstreamId: string) => void): () => void {
		return checkoutHealthService.onChanged(({ workstreamId, ...health }) => {
			this.#store(workstreamId, health);
			if (health.state === 'healthy') healed(workstreamId);
		});
	}

	async load(workstreamId: string): Promise<void> {
		const revision = this.#bump(workstreamId);
		try {
			this.#storeIfCurrent(workstreamId, revision, await checkoutHealthService.read(workstreamId));
		} catch (error) {
			console.error('[malini checkout] could not read whether the checkout works', error);
		}
	}

	async repair(workstreamId: string): Promise<void> {
		const broken = this.healthOf(workstreamId);
		const revision = this.#store(workstreamId, { ...broken, state: 'repairing' });
		try {
			this.#storeIfCurrent(
				workstreamId,
				revision,
				await checkoutHealthService.repair(workstreamId),
			);
		} catch (error) {
			this.#storeIfCurrent(workstreamId, revision, broken);
			throw error;
		}
	}

	#store(workstreamId: string, health: CheckoutHealth): number {
		const revision = this.#bump(workstreamId);
		this.byWorkstream = { ...this.byWorkstream, [workstreamId]: health };
		if (health.state !== 'repairing' && workstreamId in this.clonePercents) {
			this.clonePercents = Object.fromEntries(
				Object.entries(this.clonePercents).filter(([id]) => id !== workstreamId),
			);
		}
		return revision;
	}

	#storeIfCurrent(workstreamId: string, revision: number, health: CheckoutHealth): void {
		if (this.#revisions.get(workstreamId) === revision) this.#store(workstreamId, health);
	}

	#bump(workstreamId: string): number {
		const revision = (this.#revisions.get(workstreamId) ?? 0) + 1;
		this.#revisions.set(workstreamId, revision);
		return revision;
	}
}

export const checkoutHealthAggregate = new CheckoutHealthAggregate();
