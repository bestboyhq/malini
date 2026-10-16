<script lang="ts">
	import { AgentAccessSettings } from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection title="Agent access" description="What Claude Code may do without asking first.">
	<Well title="Default access" headed={false}>
		<AgentAccessSettings />
	</Well>
</SettingsSection>
