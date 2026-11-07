class SignPullRequestsStore {
	signed = $state<boolean | null>(null);

	set(signed: boolean | null): void {
		this.signed = signed;
	}
}

export const signPullRequestsStore = new SignPullRequestsStore();
