import {
	secretsIn,
	withSecretNames,
	type NamedSecret,
	type SecretPaste,
} from '$lib/chat/domain/pasted-secrets';
import { pastedSecretsService } from '$lib/chat/infrastructure/services/pasted-secrets.service';
import { pastedSecretsStore } from '$lib/chat/infrastructure/stores/pasted-secrets.store.svelte';

export { keepPastedSecretsCommand };

function keepPastedSecretsCommand(paste: SecretPaste): void {
	void (async () => {
		const named: NamedSecret[] = [];
		for (const found of secretsIn(paste.text)) {
			const known = pastedSecretsStore.pasted.find(
				(secret) =>
					secret.draftScope === paste.draftScope &&
					secret.value === found.value &&
					secret.state === 'kept',
			);
			if (known) {
				named.push(known);
				continue;
			}
			const pasted = {
				id: crypto.randomUUID(),
				draftScope: paste.draftScope,
				workstreamId: paste.workstreamId,
				...found,
			};
			try {
				const kept = await pastedSecretsService.keep({
					workstreamId: paste.workstreamId,
					name: found.name,
					value: found.value,
				});
				pastedSecretsStore.put({ ...pasted, ...kept, state: 'kept', failure: null });
				named.push({ value: found.value, name: kept.name });
			} catch (error) {
				pastedSecretsStore.put({
					...pasted,
					repository: null,
					created: false,
					state: 'shown',
					failure: error instanceof Error ? error.message : String(error),
				});
			}
		}
		pastedSecretsStore.land(paste.key, {
			draftScope: paste.draftScope,
			text: withSecretNames(paste.text, named),
		});
	})();
}
