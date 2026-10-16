import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { githubSignInStore } from '$shared/repositories/infrastructure/stores/github-sign-in.store.svelte';

export { cancelGithubSignInCommand };

function cancelGithubSignInCommand(): void {
	githubSignInStore.attempt += 1;
	githubSignInStore.state = { kind: 'idle' };
	void githubService.cancelSignIn().catch(() => undefined);
}
