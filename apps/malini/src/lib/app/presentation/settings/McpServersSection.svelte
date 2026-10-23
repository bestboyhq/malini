<script lang="ts">
	import { McpServersSettings } from '$lib/chat/chat.api';
	import { page } from '$shared/router/state';
	import SettingsSection from './SettingsSection.svelte';

	const workstreamId = page.params.workstreamId ?? null;
</script>

<SettingsSection
	title="MCP servers"
	description={workstreamId
		? 'What a chat in this workstream connects. Turn one off and it leaves every chat, here and in the terminal.'
		: 'What a chat connects. Turn one off and it leaves every chat, here and in the terminal.'}
>
	<McpServersSettings {workstreamId} />
</SettingsSection>
