import { toast } from '$hyper-ui/components/toast';
import { publishGithubCredentialStored } from '$shared/auth/auth-session-events';
import { clipboardService } from '$shared/system/clipboard.service';
import { externalUrlService } from '$shared/system/external-url.service';
import { githubAuthAggregate } from '$shared/repositories/infrastructure/aggregates/github-auth.aggregate.svelte';
import { githubService } from '$shared/repositories/infrastructure/services/github.service';
import { githubSignInStore } from '$shared/repositories/infrastructure/stores/github-sign-in.store.svelte';

export { signInToGithubCommand };

function signInToGithubCommand(): void {
	const attempt = ++githubSignInStore.attempt;
	const current = (): boolean => githubSignInStore.attempt === attempt;
	githubSignInStore.state = { kind: 'starting' };
	void (async () => {
		try {
			const code = await githubService.startSignIn();
			if (!current()) return;
			githubSignInStore.state = { kind: 'waiting', ...code };
			await Promise.allSettled([
				clipboardService.write(code.userCode),
				externalUrlService.open(code.verificationUri),
			]);
			const outcome = await githubService.finishSignIn();
			if (outcome === 'cancelled' || !current()) return;
			githubSignInStore.state = { kind: 'confirming' };
			await githubAuthAggregate.load();
			publishGithubCredentialStored();
		} catch (error: unknown) {
			if (current()) toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			if (current()) githubSignInStore.state = { kind: 'idle' };
		}
	})();
}
