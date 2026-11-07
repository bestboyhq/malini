class LidHoldStore {
	on = $state<boolean | null>(null);
	asking = $state(false);
	refused = $state(false);

	set(on: boolean | null): void {
		this.on = on;
	}

	ask(asking: boolean): void {
		this.asking = asking;
	}

	refuse(refused: boolean): void {
		this.refused = refused;
	}
}

export const lidHoldStore = new LidHoldStore();
