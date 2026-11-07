class SignContributionsStore {
	signed = $state<boolean | null>(null);

	set(signed: boolean | null): void {
		this.signed = signed;
	}
}

export const signContributionsStore = new SignContributionsStore();
