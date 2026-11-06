<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import AutomationSettings from '../AutomationSettings.svelte';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Automations"
	description="How much background work Malini takes on by itself."
>
	<Well title="Automations" headed={false}>
		<AutomationSettings />
	</Well>
</SettingsSection>
