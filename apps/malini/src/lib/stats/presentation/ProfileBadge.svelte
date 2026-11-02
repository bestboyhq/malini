<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { goto } from '$shared/router/navigation';
	import { PROFILE_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { RepositoryAvatar, githubAuthQuery } from '$shared/repositories/repositories.api';
	import { weekPace } from '$lib/stats/domain/pace';
	import { publishedProfileUrl } from '$lib/stats/domain/published-profile';
	import { loadActivityCommand } from '$lib/stats/application/commands/load-activity.command';
	import { loadProfileBadgeCommand } from '$lib/stats/application/commands/load-profile-badge.command';
	import { openProfilePageCommand } from '$lib/stats/application/commands/open-profile-page.command';
	import { signOutOfBestboyCommand } from '$lib/stats/application/commands/sign-out-of-bestboy.command';
	import { watchProfileHook } from '$lib/stats/application/hooks/watch-profile.hook';
	import { activityStatsQuery } from '$lib/stats/application/queries/activity-stats.query.svelte';
	import { profileStateQuery } from '$lib/stats/application/queries/profile-state.query.svelte';
	import { paceNudge } from './pace-copy';
	import { plural } from './stats-format';

	interface Props {
		onopenstats: () => void;
	}

	let { onopenstats }: Props = $props();

	const profileState = $derived(profileStateQuery.data);
	const account = $derived(profileState?.account ?? null);
	const login = $derived(githubAuthQuery.data?.login ?? null);
	const avatarName = $derived(login ? `${login}/${login}` : (account?.name ?? ''));
	const profileUrl = $derived(publishedProfileUrl(profileState));
	const handle = $derived(profileState?.profile?.handle ?? login);
	const identity = $derived(handle ? `@${handle}` : (account?.name ?? ''));
	const activity = $derived(activityStatsQuery.data);
	const week = $derived(activity ? weekPace(activity.days, activity.today) : null);
	const nudge = $derived(activity && week ? paceNudge(week.pace, activity.today) : null);
	const runsThisWeek = $derived(
		week && week.runs > 0 ? `${plural(week.runs, 'run', 'runs')} this week` : '',
	);

	let open: boolean = $state(false);

	onMount(() => {
		loadProfileBadgeCommand();
		return watchProfileHook();
	});

	function onOpenChange(next: boolean): void {
		if (next) loadActivityCommand();
	}

	function openSettings(): void {
		void goto(PROFILE_SETTINGS_HREF);
	}
</script>

{#if account}
	<Dropdown
		bind:open
		side="top"
		align="start"
		sideOffset={6}
		role={null}
		panelClass="w-64"
		testId="profile-layer"
		{onOpenChange}
	>
		{#snippet trigger()}
			<Button
				variant="ghost"
				size="auto"
				class="min-w-0 pr-2 pl-0.5 text-[13px]"
				ariaLabel={identity ? `${identity}, your profile` : 'Your profile'}
				ariaHasPopup="menu"
				ariaExpanded={open}
				active={open}
				data-testid="sidebar-open-profile"
			>
				<span class="block size-5 shrink-0 overflow-hidden rounded-full">
					{#key avatarName}
						<RepositoryAvatar fullName={avatarName} size={20} />
					{/key}
				</span>
				<span class="min-w-0 max-w-40 truncate">{identity}</span>
			</Button>
		{/snippet}

		{#snippet content()}
			<div role="menu" aria-label="Your profile">
				<div class="flex items-center gap-2.5 px-2 py-1.5 text-[13px] leading-[18px]">
					<span class="block size-7 shrink-0 overflow-hidden rounded-full">
						<RepositoryAvatar fullName={avatarName} size={28} />
					</span>
					<div class="min-w-0">
						<p class="text-fg-default truncate font-medium">{account.name}</p>
						<p
							class={[
								'text-fg-tertiary flex min-w-0 gap-1 text-xs',
								nudge ? 'items-start' : 'items-center truncate',
							]}
						>
							{#if nudge}
								<Icon name={nudge.icon} size={12} class={['mt-0.5 shrink-0', nudge.tone]} />
								<span class="min-w-0">{nudge.line}</span>
							{:else if handle}
								<span class="truncate">@{handle}</span>
							{:else}
								<SensitiveText text={account.email} />
							{/if}
						</p>
					</div>
				</div>

				{@render separator()}

				{#if profileUrl}
					<DropdownItem
						role="menuitem"
						class="gap-2.5"
						onSelect={() => openProfilePageCommand(profileUrl)}
					>
						<Icon name="external-link" size={15} class="shrink-0" />
						<span class="min-w-0 flex-1 truncate text-left">Open profile</span>
					</DropdownItem>
				{/if}
				<DropdownItem role="menuitem" class="gap-2.5" onSelect={onopenstats}>
					<Icon name="signal" size={15} class="shrink-0" />
					<span class="min-w-0 flex-1 truncate text-left">Stats</span>
					{#if runsThisWeek}
						<span class="text-fg-tertiary shrink-0 text-xs tabular-nums">
							{runsThisWeek}
						</span>
					{/if}
				</DropdownItem>
				<DropdownItem role="menuitem" class="gap-2.5" onSelect={openSettings}>
					<Icon name="settings" size={15} class="shrink-0" />
					<span class="min-w-0 flex-1 truncate text-left">Profile settings</span>
				</DropdownItem>

				{@render separator()}

				<DropdownItem role="menuitem" class="gap-2.5" onSelect={signOutOfBestboyCommand}>
					<Icon name="sign-out" size={15} class="shrink-0" />
					<span class="min-w-0 flex-1 truncate text-left">Sign out</span>
				</DropdownItem>
			</div>
		{/snippet}
	</Dropdown>
{/if}

{#snippet separator()}
	<div class="border-border-subtle mx-1 my-1 border-t-[0.5px]" role="separator"></div>
{/snippet}
