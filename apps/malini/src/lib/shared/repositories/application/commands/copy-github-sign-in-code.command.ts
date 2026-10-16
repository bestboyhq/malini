import { toast } from '$hyper-ui/components/toast';
import { clipboardService } from '$shared/system/clipboard.service';
import { githubSignInStore } from '$shared/repositories/infrastructure/stores/github-sign-in.store.svelte';

export { copyGithubSignInCodeCommand };

function copyGithubSignInCodeCommand(): void {
	const signIn = githubSignInStore.state;
	if (signIn.kind !== 'waiting') return;
	void (async () => {
		try {
			await clipboardService.write(signIn.userCode);
		} catch (error: unknown) {
			toast.error(`Could not copy · ${error instanceof Error ? error.message : String(error)}`);
		}
	})();
}
