<script lang="ts">
	import { AgentAccessSettings } from '$shared/providers/providers.api';
	import SettingsSection from '../settings/SettingsSection.svelte';
	import Well from '../settings/Well.svelte';
</script>

<svelte:head>
	<title>malini · Agent access</title>
</svelte:head>

<SettingsSection title="Agent access" description="What Claude Code may do without asking first.">
	<Well title="Default access" headed={false} class="max-w-[720px]">
		<AgentAccessSettings />
	</Well>
</SettingsSection>
