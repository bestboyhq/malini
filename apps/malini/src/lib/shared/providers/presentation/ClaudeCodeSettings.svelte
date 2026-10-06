<script lang="ts">
	import ClaudeCodeSetup from './ClaudeCodeSetup.svelte';
</script>

<section aria-labelledby="claude-code-heading">
	<h2 id="claude-code-heading" class="text-fg-default text-sm font-medium">Agent</h2>
	<p class="text-fg-tertiary mt-1 text-xs">
		Every chat runs Claude Code on this Mac, with your sign-in, plan, CLAUDE.md, skills and MCP
		servers.
	</p>
	<div class="mt-4">
		<ClaudeCodeSetup />
	</div>
</section>
