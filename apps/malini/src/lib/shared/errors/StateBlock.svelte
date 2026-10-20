<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	type StateTone = 'neutral' | 'positive' | 'caution' | 'critical';
	type StateLayout = 'panel' | 'inline';

	interface Props {
		heading: string;
		detail?: string | null;
		remedy?: string | null;
		technical?: string | null;
		tone?: StateTone;
		layout?: StateLayout;
		icon?: Snippet;
		action?: Snippet;
		testId?: string;
		live?: 'status' | 'alert';
		class?: ClassValue;
	}

	let {
		heading,
		detail = null,
		remedy = null,
		technical = null,
		tone = 'neutral',
		layout = 'panel',
		icon,
		action,
		testId,
		live = 'status',
		class: className,
	}: Props = $props();

	const tileClassByTone: Record<StateTone, string> = {
		neutral: 'bg-surface-50 text-fg-tertiary',
		positive: 'bg-success text-success-content',
		caution: 'bg-warning text-warning-content',
		critical: 'bg-error text-error-content',
	};
	const glyphClassByTone: Record<StateTone, string> = {
		neutral: 'text-fg-tertiary',
		positive: 'text-success-content',
		caution: 'text-warning-content',
		critical: 'text-error-content',
	};
	const headingClassByTone: Record<StateTone, string> = {
		neutral: 'text-fg-secondary',
		positive: 'text-fg-default',
		caution: 'text-warning-content',
		critical: 'text-error-content',
	};

	const panel = $derived(layout === 'panel');
</script>

<div
	class={[
		'flex min-w-0 flex-col',
		panel
			? 'items-center justify-center gap-2 px-8 py-10 text-center'
			: 'items-start gap-1.5 px-2 py-3 text-left',
		className,
	]}
	role={live === 'alert' ? 'alert' : 'status'}
	data-testid={testId}
	data-state-tone={tone}
	data-state-layout={layout}
>
	{#if panel}
		{#if icon}
			<div
				aria-hidden="true"
				class={['mb-1 grid h-12 w-12 place-items-center rounded-2xl', tileClassByTone[tone]]}
			>
				{@render icon()}
			</div>
		{/if}
		<p
			class={['text-sm font-medium', headingClassByTone[tone]]}
			data-testid={testId ? `${testId}-heading` : undefined}
		>
			{heading}
		</p>
	{:else}
		<div class="flex w-full min-w-0 items-center gap-1.5">
			{#if icon}
				<span
					aria-hidden="true"
					class={['grid h-4 w-4 shrink-0 place-items-center', glyphClassByTone[tone]]}
				>
					{@render icon()}
				</span>
			{/if}
			<p
				class={['text-2xs min-w-0 flex-1 leading-4 font-medium', headingClassByTone[tone]]}
				data-testid={testId ? `${testId}-heading` : undefined}
			>
				{heading}
			</p>
		</div>
	{/if}

	{#if detail}
		<p
			class={['text-2xs text-fg-secondary max-w-[46ch] leading-5', panel && 'text-balance']}
			data-testid={testId ? `${testId}-detail` : undefined}
		>
			<SensitiveText text={detail} />
		</p>
	{/if}

	{#if remedy}
		<p
			class="text-2xs text-fg-tertiary max-w-[46ch] leading-5"
			data-testid={testId ? `${testId}-remedy` : undefined}
		>
			{remedy}
		</p>
	{/if}

	{#if technical}
		<p
			class={[
				'bg-surface-50 text-2xs text-fg-tertiary max-w-[46ch] min-w-0 rounded-md px-2 py-1 font-mono leading-5 break-words',
				panel ? 'mt-0.5 text-left' : 'w-full',
			]}
			data-testid={testId ? `${testId}-technical` : undefined}
		>
			{technical}
		</p>
	{/if}

	{#if action}
		<div class={['flex flex-wrap items-center gap-2', panel ? 'mt-2' : 'mt-1']}>
			{@render action()}
		</div>
	{/if}
</div>
