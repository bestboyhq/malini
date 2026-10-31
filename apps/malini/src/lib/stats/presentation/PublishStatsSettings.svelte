<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Switch } from '$hyper-ui/components/switch';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { publishedProfileUrl } from '$lib/stats/domain/published-profile';
	import { cancelPublishingCommand } from '$lib/stats/application/commands/cancel-publishing.command';
	import { copyProfileLinkCommand } from '$lib/stats/application/commands/copy-profile-link.command';
	import { editHandleCommand } from '$lib/stats/application/commands/edit-handle.command';
	import { loadProfileCommand } from '$lib/stats/application/commands/load-profile.command';
	import { publishStatsCommand } from '$lib/stats/application/commands/publish-stats.command';
	import { signInToBestboyCommand } from '$lib/stats/application/commands/sign-in-to-bestboy.command';
	import { signOutOfBestboyCommand } from '$lib/stats/application/commands/sign-out-of-bestboy.command';
	import { turnOnPublishingCommand } from '$lib/stats/application/commands/turn-on-publishing.command';
	import { unpublishStatsCommand } from '$lib/stats/application/commands/unpublish-stats.command';
	import { watchProfileHook } from '$lib/stats/application/hooks/watch-profile.hook';
	import { profileStateQuery } from '$lib/stats/application/queries/profile-state.query.svelte';
	import { publishFlowQuery } from '$lib/stats/application/queries/publish-flow.query.svelte';
	import PublicRepositoryPicker from './PublicRepositoryPicker.svelte';
	import { publishTime, uploadLine } from './profile-copy';

	const WHAT_IS_SENT_URL = 'https://bestboy.dev/malini/docs/profile';

	const profileState = $derived(profileStateQuery.data);
	const flow = $derived(publishFlowQuery.data);
	const publishing = $derived(profileState?.publishing ?? 'off');
	const checked = $derived(publishing === 'on' || flow.turningOn);
	const choosingHandle = $derived(flow.turningOn && !!profileState?.account && publishing !== 'on');
	const waitingForSignIn = $derived(flow.turningOn && !profileState?.account);
	const signedOut = $derived(
		!!profileState && !profileState.account && !waitingForSignIn && !profileState.signInNeeded,
	);
	const handle = $derived(flow.handle ?? profileState?.suggestedHandle ?? '');
	const status = $derived(profileState ? uploadLine(profileState) : null);
	const profileUrl = $derived(publishedProfileUrl(profileState));
	const switchId = $props.id();

	onMount(() => {
		loadProfileCommand();
		return watchProfileHook();
	});

	function onSwitch(on: boolean): void {
		if (on) {
			turnOnPublishingCommand();
			return;
		}
		if (publishing === 'on') unpublishStatsCommand();
		else cancelPublishingCommand();
	}

	function onPublish(event: SubmitEvent): void {
		event.preventDefault();
		publishStatsCommand(handle);
	}

	function onHandleInput(event: Event): void {
		if (event.currentTarget instanceof HTMLInputElement)
			editHandleCommand(event.currentTarget.value);
	}

	function shownUrl(url: string): string {
		const { host, pathname } = new URL(url);
		return `${host}${pathname}`;
	}
</script>

<div class="flex min-w-0 flex-col gap-2" data-testid="publish-stats-settings">
	<div
		class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
	>
		<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
			<div class="min-w-0">
				<h3 id={`${switchId}-label`} class="text-fg-default text-sm font-medium">
					Publish my stats
				</h3>
				<p class="text-fg-tertiary text-xs">
					A public profile at bestboy.dev shows how you work with agents: runs, agents at once, the
					tokens they use, and how much of your work runs without your prompt.
				</p>
			</div>
			<Switch
				{checked}
				disabled={profileState === null || flow.sending}
				labelledBy={`${switchId}-label`}
				onchange={onSwitch}
			/>
		</div>

		{#if waitingForSignIn}
			<div class="flex items-center justify-between gap-3 px-4 py-3">
				{#if profileState?.signingIn}
					<p class="text-fg-secondary text-xs">
						Sign in to Bestboy in your browser, then come back.
					</p>
					<Button variant="ghost" size="sm" onclick={cancelPublishingCommand}>Cancel</Button>
				{:else}
					<p
						class={[
							'text-xs',
							profileState?.signInProblem ? 'text-error-content' : 'text-fg-secondary',
						]}
					>
						{profileState?.signInProblem ??
							'Malini needs your Bestboy account to publish your stats.'}
					</p>
					<div class="flex shrink-0 gap-1.5">
						<Button variant="ghost" size="sm" onclick={cancelPublishingCommand}>Cancel</Button>
						<Button variant="secondary" size="sm" onclick={turnOnPublishingCommand}>Sign in</Button>
					</div>
				{/if}
			</div>
		{:else if choosingHandle}
			<form class="flex flex-col gap-2 px-4 py-3" onsubmit={onPublish} aria-label="Choose a handle">
				<label for={`${switchId}-handle`} class="text-fg-secondary text-xs font-medium">
					Your profile address
				</label>
				<div class="flex items-center gap-2">
					<span class="text-fg-tertiary font-mono text-xs">bestboy.dev/@</span>
					<TextInput
						id={`${switchId}-handle`}
						value={handle}
						size="sm"
						maxlength={40}
						autocomplete="off"
						invalid={flow.problem !== null}
						class="min-w-0 flex-1"
						inputClass="font-mono"
						oninput={onHandleInput}
					/>
					<Button variant="ghost" size="sm" onclick={cancelPublishingCommand}>Cancel</Button>
					<Button type="submit" variant="primary" size="sm" loading={flow.sending}>Publish</Button>
				</div>
				{#if flow.problem}
					<p class="text-error-content text-xs" role="alert">{flow.problem}</p>
				{/if}
			</form>
		{/if}

		{#if profileUrl}
			<div class="flex items-center justify-between gap-3 px-4 py-3">
				<div class="min-w-0">
					<a
						href={profileUrl}
						class="text-fg-default block truncate font-mono text-sm hover:underline"
						data-testid="profile-url"
					>
						{shownUrl(profileUrl)}
					</a>
					{#if status}
						<p class="text-fg-tertiary text-xs" data-testid="profile-status">{status}</p>
					{/if}
				</div>
				<div class="flex shrink-0 gap-1.5">
					{#if profileState?.signInNeeded}
						<Button variant="secondary" size="sm" onclick={signInToBestboyCommand}>Sign in</Button>
					{/if}
					<Button variant="secondary" size="sm" onclick={() => copyProfileLinkCommand(profileUrl)}>
						{#snippet leading()}
							<Icon name="copy" size={14} />
						{/snippet}
						Copy link
					</Button>
				</div>
			</div>
			<PublicRepositoryPicker picked={profileState?.pickedRepositories ?? []} />
		{:else if status}
			<div class="flex items-center justify-between gap-3 px-4 py-3">
				<p class="text-fg-secondary text-xs" data-testid="profile-status">{status}</p>
				{#if profileState?.signInNeeded}
					<Button variant="secondary" size="sm" onclick={signInToBestboyCommand}>Sign in</Button>
				{/if}
			</div>
		{/if}

		{#if profileState?.account}
			<div class="flex items-center justify-between gap-3 px-4 py-3">
				<div class="min-w-0">
					<p class="text-fg-default truncate text-sm">
						Signed in to Bestboy as {profileState.account.name}
					</p>
					<p class="text-fg-tertiary truncate text-xs">
						<SensitiveText text={profileState.account.email} />
					</p>
				</div>
				<Button variant="secondary" size="sm" onclick={signOutOfBestboyCommand}>Sign out</Button>
			</div>
		{:else if signedOut}
			<div class="flex items-center justify-between gap-3 px-4 py-3">
				{#if profileState?.signingIn}
					<p class="text-fg-secondary text-xs">
						Sign in to Bestboy in your browser, then come back.
					</p>
					<Button variant="ghost" size="sm" onclick={cancelPublishingCommand}>Cancel</Button>
				{:else}
					<div class="min-w-0">
						<p class="text-fg-default text-sm">Not signed in to Bestboy</p>
						<p
							class={[
								'text-xs',
								profileState?.signInProblem ? 'text-error-content' : 'text-fg-tertiary',
							]}
						>
							{profileState?.signInProblem ??
								'Your Bestboy account holds your profile and your share cards.'}
						</p>
					</div>
					<Button variant="secondary" size="sm" onclick={signInToBestboyCommand}>Sign in</Button>
				{/if}
			</div>
		{/if}
	</div>

	<p class="text-fg-tertiary px-1 text-xs">
		Malini sends numbers only, never your prompts, code, file names, or the names of repositories
		you did not pick, and bestboy.dev publishes changes once a day at {publishTime(new Date())}.
		<a href={WHAT_IS_SENT_URL} class="text-fg-secondary hover:underline">
			See every number it sends
		</a>
	</p>
</div>
