import type { GitHubAuthStatus } from '$shared/repositories/domain/github-auth';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

class GitHubAuthAggregate {
	status: GitHubAuthStatus | null = $state.raw(null);
	error: string | null = $state.raw(null);

	#revision = 0;
	#reading: Promise<void> | null = null;

	load(): Promise<void> {
		return this.#reading ?? this.reload();
	}

	reload(): Promise<void> {
		const reading = this.#read(++this.#revision).finally(() => {
			if (this.#reading === reading) this.#reading = null;
		});
		this.#reading = reading;
		return reading;
	}

	async #read(revision: number): Promise<void> {
		try {
			const status = await githubService.authStatus();
			if (revision !== this.#revision) return;
			this.status = status;
			this.error = null;
		} catch (error) {
			if (revision !== this.#revision) return;
			this.status = null;
			this.error = error instanceof Error ? error.message : String(error);
		}
	}
}

export const githubAuthAggregate = new GitHubAuthAggregate();
