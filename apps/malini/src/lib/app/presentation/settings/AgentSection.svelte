<script lang="ts">
	import { ClaudeCodeSetup } from '$shared/providers/providers.api';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection
	title="Agent"
	description="Every chat runs Claude Code on this Mac, with your sign-in, plan, CLAUDE.md, skills and MCP servers."
>
	<Well title="Claude Code" headed={false}>
		<ClaudeCodeSetup nested />
	</Well>
</SettingsSection>
