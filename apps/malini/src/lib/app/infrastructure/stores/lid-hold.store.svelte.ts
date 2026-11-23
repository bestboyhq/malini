class LidHoldStore {
	on = $state<boolean | null>(null);
	available = $state(true);
	asking = $state(false);
	refused = $state(false);

	set(on: boolean | null): void {
		this.on = on;
	}

	offer(available: boolean): void {
		this.available = available;
	}

	ask(asking: boolean): void {
		this.asking = asking;
	}

	refuse(refused: boolean): void {
		this.refused = refused;
	}
}

export const lidHoldStore = new LidHoldStore();
