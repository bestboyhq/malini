import type { GitHubAuthStatus } from '$shared/repositories/domain/github-auth';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';

class GitHubAuthAggregate {
	status: GitHubAuthStatus | null = $state.raw(null);

	#revision = 0;

	async load(): Promise<void> {
		const revision = ++this.#revision;
		try {
			const status = await githubService.authStatus();
			if (revision === this.#revision) this.status = status;
		} catch {
			if (revision === this.#revision) this.status = null;
		}
	}

	reset(): void {
		this.#revision += 1;
		this.status = null;
	}
}

export const githubAuthAggregate = new GitHubAuthAggregate();
