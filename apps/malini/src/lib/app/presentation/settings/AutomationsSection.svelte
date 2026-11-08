<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import AutomationDefaultsSettings from '../AutomationDefaultsSettings.svelte';
	import AutomationSettings from '../AutomationSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Automations"
	description="How much background work Malini takes on by itself."
>
	<AutomationDefaultsSettings />
	<Well title="Limits">
		<AutomationSettings />
	</Well>
</SettingsSection>
