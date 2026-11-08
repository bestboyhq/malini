<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { onMount } from 'svelte';
	import {
		ModelDefaultsSettings,
		loadModelDefaultsCommand,
		modelDefaultsQuery,
		saveModelDefaultsCommand,
	} from '$shared/providers/providers.api';
	import ContextWindowSettings from './ContextWindowSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SteRepliesSettings from './SteRepliesSettings.svelte';

	onMount(loadModelDefaultsCommand);
</script>

<SettingsSection
	title="Models"
	description="Plan mode and Implement plan start with these models. Every chat keeps the model and effort you pick in it, and a new chat starts with the ones you picked last."
>
	<Well title="Models" headed={false}>
		<ModelDefaultsSettings models={modelDefaultsQuery.data} onchange={saveModelDefaultsCommand} />
		<ContextWindowSettings />
		<SteRepliesSettings />
	</Well>
</SettingsSection>
