<script lang="ts">
	import { Badge } from '$hyper-ui/components/badge';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		placement: 'sidebar' | 'title';
	}

	let { placement }: Props = $props();

	const SIDEBAR = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
	const TITLE = ['I', 'J', 'K', 'L'] as const;
</script>

{#snippet letter(code: string)}
	<span class="text-fg-quaternary text-3xs ml-auto shrink-0 font-mono">{code}</span>
{/snippet}

{#if placement === 'sidebar'}
	<div class="flex flex-col" data-testid="lab-label-variants-sidebar">
		{#each SIDEBAR as code (code)}
			<div class="text-fg-tertiary flex items-center gap-1.5 px-2 pt-1 pb-2.5 text-xs font-medium">
				{#if code === 'A'}
					Automations
				{:else if code === 'B'}
					Automations
					<Badge class="px-1.5 py-0 text-[10px] leading-4 font-medium">Lab</Badge>
				{:else if code === 'C'}
					Automations
					<span
						class="border-border-default text-fg-tertiary rounded-full border-[0.5px] px-1.5 text-[10px] leading-4"
					>
						Lab
					</span>
				{:else if code === 'D'}
					Automations
					<span class="text-fg-quaternary text-[9px] font-semibold tracking-wider uppercase">
						Beta
					</span>
				{:else if code === 'E'}
					Automations
					<span class="text-fg-quaternary font-normal">· Preview</span>
				{:else if code === 'F'}
					Automations
					<span class="bg-brand size-1.5 rounded-full" aria-hidden="true"></span>
				{:else if code === 'G'}
					Automations
					<Icon name="sparkles" size={11} class="text-fg-quaternary" />
				{:else}
					Automations
					<Badge variant="primary" class="px-1.5 py-0 text-[10px] leading-4 font-medium">New</Badge>
				{/if}
				{@render letter(code)}
			</div>
		{/each}
	</div>
{:else}
	<div class="flex flex-col gap-4" data-testid="lab-label-variants-title">
		{#each TITLE as code (code)}
			<div class="flex items-end gap-6 px-3">
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<h2 class="text-fg-default text-xl font-semibold tracking-tight">Automations</h2>
						{#if code === 'I'}
							<Badge class="font-medium">Preview</Badge>
						{:else if code === 'J'}
							<span
								class="border-border-default text-fg-tertiary rounded-full border-[0.5px] px-2 py-0.5 text-xs"
							>
								Lab
							</span>
						{:else if code === 'K'}
							<span class="text-fg-quaternary text-xs font-semibold tracking-wider uppercase">
								Beta
							</span>
						{/if}
					</div>
					<p class="text-fg-tertiary mt-0.5 text-xs">
						{#if code === 'L'}
							<span class="text-fg-secondary font-medium">Preview.</span>
						{/if}
						Jobs Malini runs when something happens. Say what and when, and Malini drafts the job.
					</p>
				</div>
				{@render letter(code)}
			</div>
		{/each}
	</div>
{/if}
