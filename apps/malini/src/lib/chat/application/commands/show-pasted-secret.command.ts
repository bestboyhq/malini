import { withSecretValues } from '$lib/chat/domain/pasted-secrets';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { pastedSecretsService } from '$lib/chat/infrastructure/services/pasted-secrets.service';
import { pastedSecretsStore } from '$lib/chat/infrastructure/stores/pasted-secrets.store.svelte';
import { fillComposerCommand } from './fill-composer.command';

export { showPastedSecretCommand };

function showPastedSecretCommand(id: string): void {
	const secret = pastedSecretsStore.find(id);
	if (!secret || secret.state !== 'kept') return;
	const draft = agentDrafts.draftFor(secret.draftScope).text;
	fillComposerCommand(secret.draftScope, withSecretValues(draft, [secret]));
	pastedSecretsStore.put({ ...secret, state: 'shown', created: false, failure: null });
	if (!secret.created) return;
	void (async () => {
		try {
			await pastedSecretsService.forget(secret.name, secret.repository);
		} catch (error) {
			const current = pastedSecretsStore.find(id);
			if (!current) return;
			pastedSecretsStore.put({
				...current,
				failure: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
