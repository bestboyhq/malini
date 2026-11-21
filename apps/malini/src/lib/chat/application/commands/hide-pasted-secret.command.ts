import { withSecretNames } from '$lib/chat/domain/pasted-secrets';
import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { pastedSecretsService } from '$lib/chat/infrastructure/services/pasted-secrets.service';
import { pastedSecretsStore } from '$lib/chat/infrastructure/stores/pasted-secrets.store.svelte';
import { fillComposerCommand } from './fill-composer.command';

export { hidePastedSecretCommand };

function hidePastedSecretCommand(id: string): void {
	const secret = pastedSecretsStore.find(id);
	if (!secret || secret.state !== 'shown') return;
	pastedSecretsStore.put({ ...secret, state: 'keeping', failure: null });
	void (async () => {
		try {
			const kept = await pastedSecretsService.keep({
				workstreamId: secret.workstreamId,
				name: secret.name,
				value: secret.value,
			});
			const draft = agentDrafts.draftFor(secret.draftScope).text;
			fillComposerCommand(
				secret.draftScope,
				withSecretNames(draft, [{ value: secret.value, name: kept.name }]),
			);
			pastedSecretsStore.put({ ...secret, ...kept, state: 'kept', failure: null });
		} catch (error) {
			pastedSecretsStore.put({
				...secret,
				state: 'shown',
				failure: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
