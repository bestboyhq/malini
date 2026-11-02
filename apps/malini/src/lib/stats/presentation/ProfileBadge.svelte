<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { goto } from '$shared/router/navigation';
	import { PROFILE_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { RepositoryAvatar, githubAuthQuery } from '$shared/repositories/repositories.api';
	import { dayStreak } from '$lib/stats/domain/activity';
	import { weekPace } from '$lib/stats/domain/pace';
	import { publishedProfileUrl } from '$lib/stats/domain/published-profile';
	import { loadActivityCommand } from '$lib/stats/application/commands/load-activity.command';
	import { loadProfileBadgeCommand } from '$lib/stats/application/commands/load-profile-badge.command';
	import { watchProfileHook } from '$lib/stats/application/hooks/watch-profile.hook';
	import { activityStatsQuery } from '$lib/stats/application/queries/activity-stats.query.svelte';
	import { profileStateQuery } from '$lib/stats/application/queries/profile-state.query.svelte';
	import { paceNudge } from './pace-copy';
	import { plural } from './stats-format';

	const profileState = $derived(profileStateQuery.data);
	const account = $derived(profileState?.account ?? null);
	const login = $derived(githubAuthQuery.data?.login ?? null);
	const avatarName = $derived(login ? `${login}/${login}` : (account?.name ?? ''));
	const profileUrl = $derived(publishedProfileUrl(profileState));
	const handle = $derived(profileUrl ? (profileState?.profile?.handle ?? null) : null);
	const activity = $derived(activityStatsQuery.data);
	const week = $derived(activity ? weekPace(activity.days, activity.today) : null);
	const nudge = $derived(activity && week ? paceNudge(week.pace, activity.today) : null);
	const facts = $derived.by(() => {
		if (!activity || !week) return '';
		const streak = dayStreak(activity.days, activity.today);
		return [
			week.runs > 0 && `${plural(week.runs, 'run', 'runs')} this week`,
			streak > 1 && `${streak}-day streak`,
		]
			.filter(Boolean)
			.join(' · ');
	});

	let open = $state(false);
	let trigger: HTMLAnchorElement | HTMLButtonElement | null = $state(null);

	onMount(() => {
		loadProfileBadgeCommand();
		return watchProfileHook();
	});

	function onToggle(): void {
		open = !open;
		if (open) loadActivityCommand();
	}

	function openSettings(): void {
		open = false;
		void goto(PROFILE_SETTINGS_HREF);
	}
</script>

{#if account}
	<Tooltip content="Your profile" placement="right" suppressed={open}>
		<Button
			bind:element={trigger}
			variant="ghost"
			size="auto"
			radius="full"
			class="size-6 justify-center"
			ariaLabel="Your profile"
			ariaHasPopup="dialog"
			ariaExpanded={open}
			active={open}
			onclick={onToggle}
			data-testid="sidebar-open-profile"
		>
			<span class="block overflow-hidden rounded-full">
				{#key avatarName}
					<RepositoryAvatar fullName={avatarName} size={18} />
				{/key}
			</span>
		</Button>
	</Tooltip>

	<DropdownLayer
		{open}
		anchor={trigger}
		onclose={() => (open = false)}
		side="top"
		align="start"
		role={null}
		keyboardNavigation={false}
		backdrop
		panelClass="w-76 rounded-2xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-3 shadow-popup"
		testId="profile-layer"
	>
		<div role="dialog" aria-label="Your profile" class="profile-badge flex flex-col gap-3">
			<div class="flex items-center gap-3 px-1 pt-1">
				<span class="block shrink-0 overflow-hidden rounded-full">
					<RepositoryAvatar fullName={avatarName} size={40} />
				</span>
				<div class="min-w-0">
					<p class="text-fg-default truncate text-sm font-medium">{account.name}</p>
					<p class="text-fg-tertiary truncate text-xs">
						{#if handle}@{handle}{:else}<SensitiveText text={account.email} />{/if}
					</p>
				</div>
			</div>

			{#if nudge}
				<section
					class="border-surface-elevated-border rounded-xl border-[0.5px] px-3 py-2.5"
					aria-label="Your week"
				>
					<p class="text-fg-default flex items-center gap-2 text-sm font-medium">
						<Icon
							name={nudge.icon}
							size={16}
							class={['profile-badge__icon shrink-0', nudge.tone]}
						/>
						{nudge.line}
					</p>
					{#if facts}
						<p class="text-fg-tertiary mt-1 ml-6 text-xs tabular-nums">{facts}</p>
					{/if}
				</section>
			{/if}

			<div class="flex gap-1.5">
				{#if profileUrl}
					<Button variant="secondary" size="sm" href={profileUrl} class="flex-1 justify-center">
						Open profile
						{#snippet trailing()}
							<Icon name="external-link" size={12} />
						{/snippet}
					</Button>
				{/if}
				<Button variant="secondary" size="sm" class="flex-1 justify-center" onclick={openSettings}>
					Profile settings
				</Button>
			</div>
		</div>
	</DropdownLayer>
{/if}

<style>
	.profile-badge :global(.profile-badge__icon) {
		animation: profile-badge-rise 480ms cubic-bezier(0.23, 1, 0.32, 1) 120ms backwards;
	}

	@keyframes profile-badge-rise {
		from {
			opacity: 0;
			transform: translateY(0.375rem) scale(0.6) rotate(-20deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.profile-badge :global(.profile-badge__icon) {
			animation: none;
		}
	}
</style>
