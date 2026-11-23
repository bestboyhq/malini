import type { GitSetup } from '$shared/repositories/domain/git-setup';

class GitSetupStore {
	state: GitSetup = $state.raw({ kind: 'checking' });
}

export const gitSetupStore = new GitSetupStore();
