import type { PullRequestShip } from '$lib/pull-requests/domain/pull-request-ship';

class PullRequestShipAggregate {
	shipByWorkstream: Readonly<Record<string, PullRequestShip>> = $state.raw({});
	readonly #changedSinceLoad = new Set<string>();

	shipFor(workstreamId: string): PullRequestShip | null {
		return this.shipByWorkstream[workstreamId] ?? null;
	}

	beginLoad(): void {
		this.#changedSinceLoad.clear();
	}

	finishLoad(ships: readonly PullRequestShip[]): void {
		const next: Record<string, PullRequestShip> = {};
		for (const ship of ships) {
			if (!this.#changedSinceLoad.has(ship.workstreamId)) next[ship.workstreamId] = ship;
		}
		for (const workstreamId of this.#changedSinceLoad) {
			const current = this.shipByWorkstream[workstreamId];
			if (current) next[workstreamId] = current;
		}
		this.shipByWorkstream = next;
	}

	accept(workstreamId: string, ship: PullRequestShip | null): void {
		this.#changedSinceLoad.add(workstreamId);
		const current = this.shipByWorkstream[workstreamId];
		if (ship && current && current.updatedAt > ship.updatedAt) return;
		if (ship) {
			this.shipByWorkstream = { ...this.shipByWorkstream, [workstreamId]: ship };
			return;
		}
		if (!current) return;
		const { [workstreamId]: _removed, ...rest } = this.shipByWorkstream;
		this.shipByWorkstream = rest;
	}

	reset(): void {
		this.#changedSinceLoad.clear();
		this.shipByWorkstream = {};
	}
}

export const pullRequestShipAggregate = new PullRequestShipAggregate();
