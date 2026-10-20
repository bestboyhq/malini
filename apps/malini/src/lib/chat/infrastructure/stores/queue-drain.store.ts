class QueueDrainStore {
	accepting = false;
	#locks = new Map<string, symbol>();
	#releasedWhileClosed = new Set<string>();

	holdRelease(workstreamId: string): void {
		this.#releasedWhileClosed.add(workstreamId);
	}

	takeReleases(): readonly string[] {
		const released = [...this.#releasedWhileClosed];
		this.#releasedWhileClosed.clear();
		return released;
	}

	isLocked(workstreamId: string): boolean {
		return this.#locks.has(workstreamId);
	}

	lock(workstreamId: string): symbol {
		const token = Symbol(workstreamId);
		this.#locks.set(workstreamId, token);
		return token;
	}

	unlock(workstreamId: string, token: symbol): void {
		if (this.#locks.get(workstreamId) === token) this.#locks.delete(workstreamId);
	}

	forceUnlock(workstreamId: string): void {
		this.#locks.delete(workstreamId);
	}

	reset(): void {
		this.accepting = false;
		this.#locks.clear();
		this.#releasedWhileClosed.clear();
	}
}

export const queueDrainStore = new QueueDrainStore();
