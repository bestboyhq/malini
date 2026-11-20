<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { HoverCard } from '$hyper-ui/components/hover-card';
	import { Icon, type IconName } from '$hyper-ui/icons';

	interface Props {
		label: string;
		heading: string;
		icon: IconName;
		count?: number | null;
		testId: string;
		onopen?: () => void;
		children: Snippet;
	}

	let { label, heading, icon, count = null, testId, onopen, children }: Props = $props();

	const titleId = $props.id();

	let dialog: HTMLDivElement | null = $state(null);

	async function focusCardFromKeyboard(event: MouseEvent): Promise<void> {
		if (event.detail !== 0) return;
		await tick();
		dialog?.focus({ preventScroll: true });
	}
</script>

<HoverCard
	side="bottom"
	align="end"
	sideOffset={6}
	openDelay={150}
	panelClass="w-96 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	onopenchange={(open) => {
		if (open) onopen?.();
	}}
>
	{#snippet trigger({ open })}
		<Button
			variant="ghost"
			size="sm"
			ariaHasPopup="dialog"
			ariaExpanded={open}
			active={open}
			onclick={focusCardFromKeyboard}
		>
			{#snippet leading()}<Icon name={icon} size={14} />{/snippet}
			{label}
			{#if count !== null}
				<span class="text-fg-tertiary tabular-nums">{count}</span>
			{/if}
		</Button>
	{/snippet}

	{#snippet content()}
		<div
			bind:this={dialog}
			role="dialog"
			aria-labelledby={titleId}
			tabindex="-1"
			class="max-h-[min(420px,60vh)] overflow-y-auto outline-none"
			data-testid={testId}
		>
			<h2
				id={titleId}
				class="text-fg-tertiary mb-1 flex items-center gap-1.5 px-2 pt-1 text-xs font-medium"
			>
				<Icon name={icon} size={12} />
				{heading}
			</h2>
			{@render children()}
		</div>
	{/snippet}
</HoverCard>
