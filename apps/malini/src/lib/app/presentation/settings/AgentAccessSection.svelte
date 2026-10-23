<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { PermissionGrants } from '$lib/chat/chat.api';
	import { AgentAccessSettings } from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection title="Agent access" description="What Claude Code may do without asking first.">
	<div class="flex flex-col gap-1.5">
		<Well title="Default access" headed={false}>
			<AgentAccessSettings />
		</Well>
		<Well title="Always allowed">
			<PermissionGrants />
		</Well>
	</div>
</SettingsSection>
