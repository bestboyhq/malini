import type { SavedSecret } from '$contract/secrets';

class SavedSecretsAggregate {
	secrets = $state.raw<readonly SavedSecret[] | null>(null);
	failure = $state.raw<string | null>(null);

	replace(secrets: readonly SavedSecret[]): void {
		this.secrets = secrets;
		this.failure = null;
	}

	fail(failure: string): void {
		this.failure = failure;
	}
}

export const savedSecretsAggregate = new SavedSecretsAggregate();
