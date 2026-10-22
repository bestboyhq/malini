<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { onMount } from 'svelte';
	import { ModelDefaultsSettings } from '$shared/providers/providers.api';
	import { applyModelDefaultsCommand } from '$lib/chat/application/commands/apply-model-defaults.command';
	import { loadRememberedModelsCommand } from '$lib/chat/application/commands/load-remembered-models.command';
	import { rememberedModelsQuery } from '$lib/chat/application/queries/remembered-models.query.svelte';
	import SettingsSection from './SettingsSection.svelte';

	onMount(loadRememberedModelsCommand);
</script>

<SettingsSection
	title="Models"
	description="New chats start with the model you last picked for each mode. Existing chats keep the model they started with."
>
	<Well title="Models" headed={false}>
		<ModelDefaultsSettings
			models={rememberedModelsQuery.data}
			onchange={applyModelDefaultsCommand}
		/>
	</Well>
</SettingsSection>
