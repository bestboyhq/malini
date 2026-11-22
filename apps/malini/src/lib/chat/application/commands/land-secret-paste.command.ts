import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { pastedSecretsStore } from '$lib/chat/infrastructure/stores/pasted-secrets.store.svelte';
import { fillComposerCommand } from './fill-composer.command';

export { landSecretPasteCommand };

function landSecretPasteCommand(key: string, landedInEditor: boolean): void {
	const landing = pastedSecretsStore.takeLanding(key);
	if (!landing || landedInEditor) return;
	const draft = agentDrafts.draftFor(landing.draftScope).text;
	const separator = draft === '' || /\s$/u.test(draft) ? '' : ' ';
	fillComposerCommand(landing.draftScope, `${draft}${separator}${landing.text}`);
}
