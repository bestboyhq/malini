<script lang="ts">
	import type { TrimmedOutput } from '$contract/stats';
	import { Icon } from '$hyper-ui/icons';
	import StatsBar from './StatsBar.svelte';
	import { formatTokens, plural } from './stats-format';

	interface Props {
		trimmed: TrimmedOutput;
	}

	let { trimmed }: Props = $props();

	const mostSaved = $derived(Math.max(1, ...trimmed.programs.map((entry) => entry.savedTokens)));

	function shorter(saved: number, input: number): string {
		return `${Math.round((saved / Math.max(1, input)) * 100)}%`;
	}
</script>

<section
	class="border-surface-elevated-border rounded-xl border-[0.5px] p-3"
	aria-label="Kept out of context"
>
	<div class="flex items-baseline justify-between gap-3">
		<h3 class="text-fg-secondary text-xs font-medium">Kept out of context</h3>
		<span class="text-fg-tertiary text-xs tabular-nums">
			{plural(trimmed.commands, 'command', 'commands')} · last 90 days
		</span>
	</div>
	<div class="mt-1.5 flex items-end justify-between gap-3">
		<div>
			<p
				class="text-fg-default text-3xl leading-9 font-semibold tabular-nums"
				data-testid="stats-tokens-trimmed"
			>
				{formatTokens(trimmed.savedTokens)}
			</p>
			<p class="text-fg-tertiary text-xs">tokens trimmed</p>
		</div>
		<div class="text-right">
			<p
				class="text-fg-default text-3xl leading-9 font-semibold tabular-nums"
				data-testid="stats-output-trimmed"
			>
				{shorter(trimmed.savedTokens, trimmed.inputTokens)}
			</p>
			<p class="text-fg-tertiary text-xs">of command output</p>
		</div>
	</div>
	<ul class="mt-3 space-y-2" aria-label="Tokens trimmed by command">
		{#each trimmed.programs as entry (entry.program)}
			<StatsBar
				value={formatTokens(entry.savedTokens)}
				share={entry.savedTokens / mostSaved}
				testId="stats-trimmed-row"
			>
				{#snippet lead()}
					<Icon name="terminal" size={14} class="text-fg-tertiary shrink-0" />
				{/snippet}
				<span class="font-mono text-xs">{entry.program}</span>
				{#snippet details()}
					<p class="text-fg-tertiary mt-1 mb-1.5 ml-5.5 text-xs tabular-nums">
						{plural(entry.commands, 'command', 'commands')} · {shorter(
							entry.savedTokens,
							entry.inputTokens,
						)} shorter
					</p>
				{/snippet}
			</StatsBar>
		{/each}
	</ul>
	<p class="text-fg-tertiary mt-2.5 text-xs">Noise your agents never read. They don't miss it</p>
</section>
