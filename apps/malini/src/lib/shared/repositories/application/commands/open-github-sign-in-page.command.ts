import { toast } from '$hyper-ui/components/toast';
import { externalUrlService } from '$shared/system/external-url.service';
import { githubSignInStore } from '$shared/repositories/infrastructure/stores/github-sign-in.store.svelte';

export { openGithubSignInPageCommand };

function openGithubSignInPageCommand(): void {
	const signIn = githubSignInStore.state;
	if (signIn.kind !== 'waiting') return;
	void (async () => {
		try {
			await externalUrlService.open(signIn.verificationUri);
		} catch (error: unknown) {
			toast.error(
				`Could not open GitHub · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
