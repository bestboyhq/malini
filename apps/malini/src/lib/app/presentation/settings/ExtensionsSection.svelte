<script lang="ts">
	import { ExtensionsSettings } from '$lib/extensions/extensions.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Extensions"
	description="MCP servers and skills for every chat in Malini. Turn one off and it leaves every chat at its next prompt."
>
	<ExtensionsSettings />
</SettingsSection>
