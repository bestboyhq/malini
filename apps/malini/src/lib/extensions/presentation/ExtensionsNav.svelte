<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import {
		EXTENSIONS_HREF,
		EXTENSIONS_INSTALLED_HREF,
		EXTENSIONS_PUBLISHED_HREF,
	} from '$shared/router/routes-hrefs';
	import { installedCountQuery } from '../application/queries/installed-count.query.svelte';
	import type { ExtensionsView } from './extensions-view';

	interface Props {
		backHref: string;
		backLabel: string;
		view: ExtensionsView;
	}

	let { backHref, backLabel, view }: Props = $props();

	const SECTIONS: readonly Readonly<{
		value: ExtensionsView;
		label: string;
		icon: IconName;
		href: string;
	}>[] = [
		{ value: 'discover', label: 'Discover', icon: 'sparkles', href: EXTENSIONS_HREF },
		{ value: 'installed', label: 'Installed', icon: 'check', href: EXTENSIONS_INSTALLED_HREF },
		{ value: 'published', label: 'Published', icon: 'send', href: EXTENSIONS_PUBLISHED_HREF },
	];

	const installedCount = $derived(installedCountQuery.data);

	function slideIn(node: HTMLElement): ReturnType<typeof fly> {
		return fly(node, {
			x: 24,
			duration: prefersReducedMotion.current ? 0 : 220,
			easing: cubicOut,
		});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" in:slideIn data-testid="extensions-nav">
	<div class="px-2.5 pt-1">
		<Button bare href={backHref} class="sidebar-row text-fg-secondary w-full gap-1.5 px-2">
			<Icon name="chevron-left" size={14} />
			<span class="min-w-0 truncate">{backLabel}</span>
		</Button>
	</div>

	<nav class="flex flex-col gap-px px-2.5 pt-4" aria-label="Extensions">
		<h2 class="text-fg-tertiary px-2 pt-1 pb-2.5 text-xs font-medium">Extensions</h2>
		{#each SECTIONS as section (section.value)}
			{@const current = view === section.value}
			<Button
				bare
				href={section.href}
				{...current ? { ariaCurrent: 'page' as const } : {}}
				class={[
					'sidebar-row w-full gap-2 px-2',
					current ? 'sidebar-row-active' : 'text-fg-secondary',
				]}
			>
				<Icon name={section.icon} size={16} class="shrink-0" />
				<span class="min-w-0 flex-1 truncate text-left">{section.label}</span>
				{#if section.value === 'installed' && installedCount > 0}
					<span class="text-fg-tertiary text-3xs font-mono tabular-nums">{installedCount}</span>
				{/if}
			</Button>
		{/each}
	</nav>
</div>
