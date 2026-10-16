import type { GitHubAuthStatus } from '$shared/repositories/domain/github-auth';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

class GitHubAuthAggregate {
	status: GitHubAuthStatus | null = $state.raw(null);
	error: string | null = $state.raw(null);

	#revision = 0;

	async load(): Promise<void> {
		const revision = ++this.#revision;
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

	reset(): void {
		this.#revision += 1;
		this.status = null;
		this.error = null;
	}
}

export const githubAuthAggregate = new GitHubAuthAggregate();
