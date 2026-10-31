<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { ClaudeCodeSetup } from '$shared/providers/providers.api';
	import { GitHubSetup } from '$shared/repositories/repositories.api';
	import SettingsSection from './SettingsSection.svelte';
</script>

<SettingsSection
	title="Accounts"
	description="Every chat runs Claude Code on this Mac with the Claude account in use, your CLAUDE.md, skills and MCP servers. Clones and pull requests go through your GitHub account."
>
	<Well title="Claude Code" headed={false}>
		<ClaudeCodeSetup nested />
	</Well>
	<Well title="GitHub" headed={false}>
		<GitHubSetup nested />
	</Well>
</SettingsSection>
