import { toast } from '$hyper-ui/components/toast';
import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';
import { claudeAccountsStore } from '$shared/providers/infrastructure/stores/claude-accounts.store.svelte';
import { providerCapabilitiesStore } from '$shared/providers/infrastructure/stores/provider-capabilities.store.svelte';

export { signInToClaudeCommand };

function signInToClaudeCommand(email: string | null = null): void {
	claudeAccountsStore.remember(signedInEmail());
	claudeAccountsStore.signIn = email ? 'switching' : 'waiting-for-browser';
	void (async () => {
		try {
			const switched =
				email !== null && (await claudeSetupService.switchAccount(email)) === 'switched';
			if (!switched) {
				claudeAccountsStore.signIn = 'waiting-for-browser';
				if ((await claudeSetupService.signIn(email)) === 'cancelled') return;
				claudeAccountsStore.signIn = 'confirming';
			}
			await providerCapabilitiesStore.reload();
			claudeAccountsStore.remember(signedInEmail());
			claudeAccountsStore.signIn = 'idle';
		} catch (error: unknown) {
			claudeAccountsStore.signIn = 'idle';
			toast.error(error instanceof Error ? error.message : String(error));
		}
	})();
}

function signedInEmail(): string | undefined {
	return providerCapabilitiesStore.capability?.account?.email;
}
