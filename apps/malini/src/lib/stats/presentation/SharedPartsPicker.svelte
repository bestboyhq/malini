<script lang="ts">
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import type { SharedParts, StatsPart } from '$contract/stats';
	import { sharePartCommand } from '$lib/stats/application/commands/share-part.command';

	interface Props {
		parts: SharedParts;
	}

	let { parts }: Props = $props();

	const PARTS: ReadonlyArray<Readonly<{ part: StatsPart; label: string; description: string }>> = [
		{
			part: 'techniques',
			label: 'How runs work',
			description: 'How many runs use the browser, sub-agents, skills, MCP servers, and the web',
		},
		{ part: 'tools', label: 'Tools', description: 'Calls per built-in tool, like Bash and Edit' },
		{ part: 'models', label: 'Models', description: 'Runs per model family' },
		{ part: 'languages', label: 'Languages', description: 'Lines changed per language' },
		{
			part: 'mcpServers',
			label: 'MCP servers',
			description: 'Calls per server, named only when the public catalog lists it',
		},
		{
			part: 'skills',
			label: 'Skills',
			description: 'Uses per skill, named only when the public catalog lists it',
		},
	];

	const headingId = $props.id();
</script>

<section class="px-4 py-3" aria-labelledby={headingId}>
	<h3 id={headingId} class="text-fg-default text-sm font-medium">What your profile shows</h3>
	<p class="text-fg-tertiary text-xs">
		Runs, agents at once, run lengths, and your active days always show. A part you turn off
		disappears from your profile.
	</p>
	<ul class="-mx-1.5 mt-2 flex flex-col" aria-labelledby={headingId}>
		{#each PARTS as { part, label, description } (part)}
			<li>
				<Checkbox
					checked={parts[part]}
					{label}
					{description}
					onchange={(on) => sharePartCommand(part, on)}
				/>
			</li>
		{/each}
	</ul>
</section>
