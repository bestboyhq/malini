<script lang="ts">
	import { ClaudeCodeSetup } from '$shared/providers/providers.api';
	import SettingsSection from '../settings/SettingsSection.svelte';
	import Well from '../settings/Well.svelte';
</script>

<svelte:head>
	<title>malini · Agent</title>
</svelte:head>

<SettingsSection
	title="Agent"
	description="Every chat runs Claude Code on this Mac, with your sign-in, plan, CLAUDE.md, skills and MCP servers."
>
	<Well title="Claude Code" headed={false} class="max-w-[720px]">
		<ClaudeCodeSetup nested />
	</Well>
</SettingsSection>
