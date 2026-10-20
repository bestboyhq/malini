<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Modal } from '$hyper-ui/components/modal';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import type { PageState } from '$shared/router/hash-router.svelte';
	import { MODEL_SETTINGS_HREF, SKILL_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { page } from '$shared/router/state';
	import { loadRuntimeInfoCommand } from '$lib/app/application/commands/load-runtime-info.command';
	import { runtimeInfoQuery } from '$lib/app/application/queries/runtime-info.query.svelte';
	import AgentAccessSection from './AgentAccessSection.svelte';
	import AgentSection from './AgentSection.svelte';
	import AppearanceSection from './AppearanceSection.svelte';
	import JobsSection from './JobsSection.svelte';
	import ModelsSection from './ModelsSection.svelte';
	import PrivacySection from './PrivacySection.svelte';
	import SkillsSection from './SkillsSection.svelte';

	type Section = Readonly<{ href: string; label: string; icon: IconName; content: Component }>;

	const AGENT: Section = {
		href: '/settings',
		label: 'Agent',
		icon: 'sparkles',
		content: AgentSection,
	};
	const APPEARANCE: Section = {
		href: '/settings/appearance',
		label: 'Appearance',
		icon: 'contrast',
		content: AppearanceSection,
	};
	const SECTIONS: readonly Section[] = [
		AGENT,
		{ href: MODEL_SETTINGS_HREF, label: 'Models', icon: 'brain', content: ModelsSection },
		{
			href: '/settings/agent-access',
			label: 'Agent access',
			icon: 'shield-alert',
			content: AgentAccessSection,
		},
		{ href: SKILL_SETTINGS_HREF, label: 'Skills', icon: 'puzzle', content: SkillsSection },
		APPEARANCE,
		{ href: '/settings/jobs', label: 'Jobs', icon: 'checklist', content: JobsSection },
		{ href: '/settings/privacy', label: 'Privacy', icon: 'lock', content: PrivacySection },
	];

	let closedEntry: PageState | null = $state.raw(null);
	const href = $derived(page.state === closedEntry ? undefined : page.state.settings);
	const current = $derived(SECTIONS.find((section) => section.href === href) ?? AGENT);
	const previewing = $derived(current === APPEARANCE);
	const runtime = $derived(runtimeInfoQuery.data);

	onMount(loadRuntimeInfoCommand);

	function close(): void {
		closedEntry = page.state;
		history.back();
	}
</script>

<Modal
	open={href !== undefined}
	ariaLabel="Settings"
	backdrop={previewing ? 'clear' : 'dim'}
	onclose={close}
	class={[
		'h-[min(720px,calc(100vh_-_4rem))] overflow-hidden rounded-[32px] transition-[width] duration-300 ease-in-out motion-reduce:transition-none',
		previewing ? 'w-[min(744px,calc(100vw_-_4rem))]' : 'w-[min(960px,calc(100vw_-_4rem))]',
	]}
	contentClass="bg-surface-root flex size-full min-h-0 select-none"
>
	{#snippet children(dismiss)}
		<nav class="flex w-[220px] shrink-0 flex-col gap-px px-2.5 pt-4 pb-3" aria-label="Settings">
			<h2 class="text-fg-tertiary px-2 pt-1 pb-2.5 text-xs font-medium">Settings</h2>
			{#each SECTIONS as section (section.href)}
				{@const selected = section === current}
				<a
					href={section.href}
					aria-current={selected ? 'page' : undefined}
					class={['sidebar-row gap-2 px-2', selected ? 'sidebar-row-active' : 'text-fg-secondary']}
				>
					<Icon name={section.icon} size={16} />
					{section.label}
				</a>
			{/each}
			{#if runtime}
				<p class="text-fg-tertiary text-3xs mt-auto px-2 font-mono">Malini {runtime.app}</p>
			{/if}
		</nav>

		<div
			class="bg-surface-50 border-surface-50-border relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
		>
			<div class="absolute top-5 right-4.5 z-10">
				<Tooltip content="Close" placement="bottom">
					<IconButton
						variant="ghost"
						size="sm"
						ariaLabel="Close settings"
						ariaKeyshortcuts="Escape"
						onclick={dismiss}
					>
						<Icon name="close" size={16} />
					</IconButton>
				</Tooltip>
			</div>
			<current.content />
		</div>
	{/snippet}
</Modal>
