import { toast } from '$hyper-ui/components/toast';
import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';
import { claudeAccountsStore } from '$shared/providers/infrastructure/stores/claude-accounts.store.svelte';

export { cancelClaudeSignInCommand };

function cancelClaudeSignInCommand(): void {
	claudeAccountsStore.signIn = 'idle';
	void (async () => {
		try {
			await claudeSetupService.cancelSignIn();
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	})();
}
