<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { PermissionGrants } from '$lib/chat/chat.api';
	import { osQuery } from '$shared/os/os.api';
	import { AgentAccessSettings, WindowsSandboxSetup } from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection title="Agent access" description="What Claude Code may do without asking first.">
	<Well title="Default access" headed={false}>
		<AgentAccessSettings />
	</Well>
	{#if osQuery.data.platform === 'win32'}
		<Well title="Sandbox" headed={false}>
			<WindowsSandboxSetup />
		</Well>
	{/if}
	<Well title="Always allowed">
		<PermissionGrants />
	</Well>
</SettingsSection>
