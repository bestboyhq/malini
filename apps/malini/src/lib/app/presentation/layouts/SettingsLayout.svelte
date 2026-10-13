<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { registerEscapeScope } from '$hyper-ui/overlay';
	import { goto } from '$shared/router/navigation';
	import { page } from '$shared/router/state';
	import { loadRuntimeInfoCommand } from '$lib/app/application/commands/load-runtime-info.command';
	import { runtimeInfoQuery } from '$lib/app/application/queries/runtime-info.query.svelte';
	import { settingsOrigin } from '../settings/settings-origin';

	interface Props {
		children: Snippet;
	}

	type Section = Readonly<{ href: string; label: string; icon: IconName }>;

	let { children }: Props = $props();

	const SECTIONS: readonly Section[] = [
		{ href: '/settings', label: 'Agent', icon: 'sparkles' },
		{ href: '/settings/agent-access', label: 'Agent access', icon: 'shield-alert' },
		{ href: '/settings/appearance', label: 'Appearance', icon: 'contrast' },
		{ href: '/settings/jobs', label: 'Jobs', icon: 'checklist' },
		{ href: '/settings/privacy', label: 'Privacy', icon: 'lock' },
	];

	const origin = settingsOrigin();
	const runtime = $derived(runtimeInfoQuery.data);
	const pathname = $derived(page.url.pathname);

	onMount(() => {
		loadRuntimeInfoCommand();
		return registerEscapeScope(close);
	});

	function close(): void {
		void goto(origin.href);
	}
</script>

<div class="bg-surface-root flex h-full min-h-0 select-none" data-testid="settings-page">
	<nav
		class="native-band-row-reserve flex w-[220px] shrink-0 flex-col gap-px px-2.5 pb-3"
		aria-label="Settings"
	>
		<h1 class="text-fg-tertiary px-2 pt-1 pb-2.5 text-xs font-medium">Settings</h1>
		{#each SECTIONS as section (section.href)}
			{@const current = pathname === section.href}
			<a
				href={section.href}
				aria-current={current ? 'page' : undefined}
				class={['sidebar-row gap-2 px-2', current ? 'sidebar-row-active' : 'text-fg-secondary']}
			>
				<Icon name={section.icon} size={16} />
				{section.label}
			</a>
		{/each}
		{#if runtime}
			<p class="text-fg-tertiary text-3xs mt-auto px-2 font-mono">malini {runtime.app}</p>
		{/if}
	</nav>

	<div
		class="bg-surface-50 border-surface-50-border my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
	>
		<div class="flex h-8 shrink-0 items-center justify-end px-2.5" data-native-drag-region>
			<Button variant="ghost" size="md" ariaKeyshortcuts="Escape" onclick={close}>
				Close
				{#snippet trailing()}
					<kbd
						class="bg-surface-100 border-surface-100-border text-fg-tertiary text-3xs rounded border-[0.5px] px-1.5 font-sans leading-[18px]"
					>
						Esc
					</kbd>
				{/snippet}
			</Button>
		</div>
		<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Settings section">
			{@render children()}
		</ScrollableDiv>
	</div>
</div>
