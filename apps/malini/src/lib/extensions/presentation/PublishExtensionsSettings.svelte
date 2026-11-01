<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import type { PublishableExtension } from '$contract/marketplace';
	import { claimHandleCommand } from '../application/commands/claim-handle.command';
	import { loadPublishingCommand } from '../application/commands/load-publishing.command';
	import { openExternalUrlCommand } from '../application/commands/open-external-url.command';
	import { publishExtensionCommand } from '../application/commands/publish-extension.command';
	import { followPublishingHook } from '../application/hooks/follow-publishing.hook';
	import { extensionActionQuery } from '../application/queries/extension-action.query.svelte';
	import { handleClaimQuery } from '../application/queries/handle-claim.query.svelte';
	import { publishingQuery } from '../application/queries/publishing.query.svelte';
	import ExtensionTile from './ExtensionTile.svelte';

	const HOW_TO_URL = 'https://bestboy.dev/malini/docs/extensions';

	const listing = $derived(publishingQuery.data);
	const publishing = $derived(listing.publishing);
	const claim = $derived(handleClaimQuery.data);
	const canPublish = $derived(publishing?.signedIn === true && publishing.handle !== null);
	const handleId = $props.id();
	let handle = $state('');

	onMount(() => {
		loadPublishingCommand();
		return followPublishingHook();
	});

	function onClaim(event: SubmitEvent): void {
		event.preventDefault();
		claimHandleCommand(handle);
	}

	function titleOf(extension: PublishableExtension): string {
		return extension.displayName ?? extension.repository;
	}
</script>

{#if listing.failure}
	<StateBlock
		tone="critical"
		heading="Malini could not read your repositories"
		detail={listing.failure}
		live="alert"
	/>
{:else if publishing === null}
	<Skeleton height="52px" class="rounded-xl" />
{:else if publishing.extensions.length === 0}
	<p class="text-fg-tertiary px-3 pb-1.5 text-xs">
		A repository with a malini.json at its root shows here, ready to publish.
		<Button
			bare
			class="text-fg-secondary hover:text-fg-default cursor-pointer underline underline-offset-2"
			onclick={() => openExternalUrlCommand(HOW_TO_URL)}
		>
			How to make one
		</Button>
	</p>
{:else}
	<ul
		class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
		aria-label="Repositories with an extension"
	>
		{#each publishing.extensions as extension (extension.repositoryId)}
			{@const action = extensionActionQuery.data(`publish:${extension.repositoryId}`)}
			{@const working = action?.status === 'working'}
			<li aria-label={titleOf(extension)}>
				<div
					class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 pr-3 pl-3.5"
				>
					<ExtensionTile name={titleOf(extension)} />
					<div class="min-w-0">
						<h4 class="text-fg-default truncate text-sm font-medium">{titleOf(extension)}</h4>
						<p class="text-fg-tertiary truncate text-xs">
							{extension.repository} · {extension.liveVersion
								? `Published ${extension.liveVersion}`
								: 'Not published yet'}
						</p>
					</div>
					{#if extension.version}
						<Button
							variant="primary"
							size="xs"
							loading={working}
							disabled={!canPublish || extension.problem !== null || working}
							onclick={() => publishExtensionCommand(extension)}
						>
							{working ? 'Publishing' : `Publish ${extension.version}`}
						</Button>
					{/if}
				</div>
				{#if action?.status === 'failed'}
					<p class="text-error-content pr-3 pb-2.5 pl-13.5 text-xs" role="alert">
						{action.error}
					</p>
				{:else if extension.problem}
					<p class="text-warning-content pr-3 pb-2.5 pl-13.5 text-xs">{extension.problem}</p>
				{/if}
			</li>
		{/each}
	</ul>

	{#if !publishing.signedIn}
		<p class="text-fg-tertiary px-3 pb-1.5 text-xs">Sign in to Bestboy above to publish.</p>
	{:else if !publishing.handle}
		<form class="flex flex-wrap items-center gap-2 px-3 pb-1.5" onsubmit={onClaim}>
			<label for={handleId} class="text-fg-secondary text-xs">Publish under bestboy.dev/@</label>
			<TextInput
				id={handleId}
				bind:value={handle}
				size="xs"
				placeholder="your-handle"
				autocomplete="off"
				class="w-48"
			/>
			<Button
				type="submit"
				variant="secondary"
				size="xs"
				loading={claim.claiming}
				disabled={claim.claiming || handle.trim().length === 0}
			>
				Claim
			</Button>
			{#if claim.problem}
				<p class="text-error-content w-full text-xs" role="alert">{claim.problem}</p>
			{/if}
		</form>
	{:else if claim.problem}
		<p class="text-error-content px-3 pb-1.5 text-xs" role="alert">{claim.problem}</p>
	{/if}
{/if}
