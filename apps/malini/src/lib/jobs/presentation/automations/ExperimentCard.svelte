<script lang="ts">
	import type { JobExperimentRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';

	interface Props {
		experiment: JobExperimentRecord;
		setup: string;
		broke: number | null;
		best: boolean;
		sampleSize: number;
		selected: boolean;
		busy: boolean;
		onselect: () => void;
		onrerun: () => void;
		ondelete: () => void;
	}

	let {
		experiment,
		setup,
		broke,
		best,
		sampleSize,
		selected,
		busy,
		onselect,
		onrerun,
		ondelete,
	}: Props = $props();
</script>

<article
	class={[
		'bg-surface-50 border-surface-50-border relative flex w-full min-w-0 rounded-xl border-[0.5px]',
		selected && 'ring-border-default ring-1',
	]}
	aria-label={experiment.name}
>
	<Button
		bare
		ariaLabel={`Show ${experiment.name}`}
		ariaPressed={selected}
		onclick={onselect}
		class="hover:bg-surface-50-hover focus-visible:ring-border-default/50 absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2"
	/>
	<div class="pointer-events-none relative flex w-full min-w-0 flex-col gap-2 py-3 pr-2 pl-4">
		<div class="flex min-w-0 items-center gap-2">
			<span class="text-fg-default truncate text-xs font-medium">{experiment.name}</span>
			{#if experiment.current}
				<span class="text-fg-tertiary text-2xs shrink-0">in use</span>
			{/if}
			<span class="pointer-events-auto ml-auto flex shrink-0">
				<Tooltip content="Run again" placement="top">
					<IconButton
						variant="ghost"
						size="xs"
						ariaLabel={`Run ${experiment.name} again`}
						disabled={busy || experiment.running || sampleSize === 0}
						onclick={onrerun}
					>
						<Icon name="refresh" size={12} />
					</IconButton>
				</Tooltip>
				{#if !experiment.current}
					<Tooltip content="Delete" placement="top">
						<IconButton
							variant="ghost"
							size="xs"
							ariaLabel={`Delete ${experiment.name}`}
							disabled={busy}
							onclick={ondelete}
						>
							<Icon name="trash" size={12} />
						</IconButton>
					</Tooltip>
				{/if}
			</span>
		</div>
		<span class="text-fg-tertiary line-clamp-2 text-xs">{setup}</span>
		{#if experiment.running}
			<span class="text-fg-tertiary flex items-center gap-1.5 text-xs">
				<BusyIcon size={11} />
				Running on {sampleSize}
				{sampleSize === 1 ? 'run' : 'runs'}…
			</span>
		{:else if broke === null}
			<span class="text-fg-tertiary text-xs">Not run yet</span>
		{:else}
			<span
				class={[
					'text-xl font-semibold tabular-nums',
					best ? 'text-success-content' : 'text-warning-content',
				]}
			>
				{broke}
				<span class="text-fg-tertiary text-xs font-normal">
					of {sampleSize} broke a rule
				</span>
			</span>
		{/if}
	</div>
</article>
