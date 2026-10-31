class HandleClaimsStore {
	problem = $state.raw<string | null>(null);
	claiming: boolean = $state(false);

	start(): void {
		this.claiming = true;
		this.problem = null;
	}

	finish(problem: string | null): void {
		this.claiming = false;
		this.problem = problem;
	}
}

export const handleClaimsStore = new HandleClaimsStore();
