<script lang="ts">
	import { ClaudeCodeSetup } from '$shared/providers/providers.api';
	import { GitHubSetup } from '$shared/repositories/repositories.api';
	import SettingsSection from './SettingsSection.svelte';
	import Well from './Well.svelte';
</script>

<SettingsSection
	title="Agent"
	description="Every chat runs Claude Code on this Mac, with your sign-in, plan, CLAUDE.md, skills and MCP servers. Clones and pull requests go through your GitHub account."
>
	<div class="flex flex-col gap-1.5">
		<Well title="Claude Code" headed={false}>
			<ClaudeCodeSetup nested />
		</Well>
		<Well title="GitHub" headed={false}>
			<GitHubSetup nested />
		</Well>
	</div>
</SettingsSection>
