<script lang="ts">
	import { onMount } from 'svelte';
	import { chooseOnboardingSidebarCommand } from '$lib/app/application/commands/choose-onboarding-sidebar.command';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import { onboardingSidebarArrangement, type OnboardingWhere } from '$lib/app/domain/onboarding';
	import type { SidebarShow } from '$lib/app/domain/sidebar-arrangement';
	import type { SidebarDensity } from '$lib/app/domain/sidebar-density';
	import {
		githubRepositoriesQuery,
		loadGithubRepositoriesCommand,
		reloadGithubRepositoriesOnSignInHook,
	} from '$shared/repositories/repositories.api';
	import ChoiceSwitch from '../settings/ChoiceSwitch.svelte';
	import SidebarPreview from './SidebarPreview.svelte';

	const WHERE: readonly OnboardingWhere[] = ['many', 'one'];
	const WHERE_LABELS: Readonly<Record<OnboardingWhere, string>> = {
		many: 'Many repositories',
		one: 'One project',
	};
	const WHERE_HINTS: Readonly<Record<OnboardingWhere, string>> = {
		many: 'Grouped by organization and repository.',
		one: 'One flat list, grouped by status.',
	};
	const SHOW: readonly SidebarShow[] = ['everything', 'attention'];
	const SHOW_LABELS: Readonly<Record<SidebarShow, string>> = {
		everything: 'Everything',
		attention: 'Only what needs me',
	};
	const SHOW_HINTS: Readonly<Record<SidebarShow, string>> = {
		everything: 'Every workstream, in every status.',
		attention: 'Questions, failures and open reviews. The rest hides until you ask.',
	};
	const DENSITY: readonly SidebarDensity[] = ['compact', 'comfortable'];
	const DENSITY_LABELS: Readonly<Record<SidebarDensity, string>> = {
		compact: 'Compact',
		comfortable: 'Comfortable',
	};
	const DENSITY_HINTS: Readonly<Record<SidebarDensity, string>> = {
		compact: 'Tighter rows. More fit.',
		comfortable: 'Roomier rows. Fewer fit.',
	};

	const choice = $derived(onboardingQuery.data.sidebar);
	const listing = $derived(githubRepositoriesQuery.data);
	const recent = $derived(
		listing.kind === 'loaded' ? listing.repositories.map((repository) => repository.fullName) : [],
	);
	const caption = $derived(
		recent.length > 0
			? 'Your recent repositories, with sample work.'
			: 'Sample repositories and work.',
	);

	onMount(() => {
		loadGithubRepositoriesCommand();
		return reloadGithubRepositoriesOnSignInHook();
	});
</script>

<div class="flex gap-6">
	<div class="flex min-w-0 flex-1 flex-col gap-5">
		<section class="flex flex-col items-start gap-2">
			<h2 class="text-fg-default text-[15px] font-medium">Where do you work?</h2>
			<ChoiceSwitch
				label="Where you work"
				choices={WHERE}
				labels={WHERE_LABELS}
				selected={choice.where}
				onchoose={(where) => chooseOnboardingSidebarCommand({ where })}
			/>
			<p class="text-fg-tertiary text-[13px] leading-[18px]">{WHERE_HINTS[choice.where]}</p>
		</section>
		<section class="flex flex-col items-start gap-2">
			<h2 class="text-fg-default text-[15px] font-medium">What should it show?</h2>
			<ChoiceSwitch
				label="What it shows"
				choices={SHOW}
				labels={SHOW_LABELS}
				selected={choice.show}
				onchoose={(show) => chooseOnboardingSidebarCommand({ show })}
			/>
			<p class="text-fg-tertiary text-[13px] leading-[18px]">{SHOW_HINTS[choice.show]}</p>
		</section>
		<section class="flex flex-col items-start gap-2">
			<h2 class="text-fg-default text-[15px] font-medium">How tall should rows be?</h2>
			<ChoiceSwitch
				label="Row height"
				choices={DENSITY}
				labels={DENSITY_LABELS}
				selected={choice.density}
				onchoose={(density) => chooseOnboardingSidebarCommand({ density })}
			/>
			<p class="text-fg-tertiary text-[13px] leading-[18px]">{DENSITY_HINTS[choice.density]}</p>
		</section>
	</div>
	<div class="flex w-56 shrink-0 flex-col gap-2">
		<h2 class="text-fg-default text-[15px] font-medium">Your sidebar</h2>
		<SidebarPreview
			arrangement={onboardingSidebarArrangement(choice)}
			compact={choice.density === 'compact'}
			{recent}
			loading={listing.kind === 'loading'}
		/>
		<p class="text-fg-tertiary text-[13px] leading-[18px]" data-testid="onboarding-sidebar-caption">
			{caption}
		</p>
	</div>
</div>
