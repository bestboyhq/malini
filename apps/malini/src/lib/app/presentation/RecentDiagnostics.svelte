<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import type { DiagnosticLevel } from '$contract/diagnostics';
	import { loadRecentDiagnosticsCommand } from '$lib/app/application/commands/load-recent-diagnostics.command';
	import { recentDiagnosticsQuery } from '$lib/app/application/queries/recent-diagnostics.query.svelte';
	import {
		diagnosticHeadline,
		diagnosticRepeatNote,
		diagnosticSourceLabel,
	} from '$lib/app/domain/recent-diagnostics';

	const recent = $derived(recentDiagnosticsQuery.data);

	const levelBadge: Record<DiagnosticLevel, 'error' | 'warning' | 'neutral'> = {
		error: 'error',
		warn: 'warning',
		info: 'neutral',
	};

	onMount(() => {
		loadRecentDiagnosticsCommand();
	});

	function onRefresh(): void {
		loadRecentDiagnosticsCommand();
	}

	function clockTime(occurredAt: string): string {
		return new Date(occurredAt).toLocaleTimeString([], { hour12: false });
	}
</script>

<section
	class="border-surface-150-border bg-surface-150 w-full max-w-3xl rounded-md border"
	aria-labelledby="recent-diagnostics-heading"
	data-testid="recent-diagnostics"
>
	<header class="border-surface-150-border flex items-center justify-between border-b px-4 py-2">
		<h2 id="recent-diagnostics-heading" class="text-fg-default text-sm font-semibold">
			Errors, warnings and toasts
		</h2>
		<Button size="xs" variant="ghost" onclick={onRefresh}>Refresh</Button>
	</header>

	{#if recent.failure}
		<p class="text-error-content px-4 py-3 text-xs" role="alert">{recent.failure}</p>
	{/if}

	{#if recent.entries && recent.entries.length > 0}
		<ol class="divide-surface-150-border divide-y" aria-label="Recent diagnostics">
			{#each recent.entries as entry, index (`${entry.occurredAt}-${index}`)}
				<li class="flex flex-col gap-1 px-4 py-2" data-testid="recent-diagnostic">
					<div class="text-fg-tertiary flex flex-wrap items-center gap-2 font-mono text-[11px]">
						<Badge variant={levelBadge[entry.level]}>{entry.level}</Badge>
						<time datetime={entry.occurredAt}>{clockTime(entry.occurredAt)}</time>
						<span>{entry.process}</span>
						<span>{diagnosticSourceLabel(entry)}</span>
						{#if entry.workstreamId}
							<span>workstream {entry.workstreamId}</span>
						{/if}
						{#if entry.viewing}
							<span>viewing {entry.viewing}</span>
						{/if}
						{#if diagnosticRepeatNote(entry)}
							<span>{diagnosticRepeatNote(entry)}</span>
						{/if}
					</div>
					<p class="text-fg-default font-mono text-xs break-words whitespace-pre-wrap">
						{diagnosticHeadline(entry)}
					</p>
					{#if entry.detail}
						<p
							class="text-fg-secondary pl-4 font-mono text-[11px] break-words whitespace-pre-wrap"
							data-testid="recent-diagnostic-detail"
						>
							{entry.detail}
						</p>
					{/if}
				</li>
			{/each}
		</ol>
	{:else if recent.entries}
		<p class="text-fg-secondary px-4 py-3 text-xs">No errors, warnings or toasts recorded yet.</p>
	{/if}
</section>
