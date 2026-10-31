<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { PageSection } from '$hyper-ui/components/page-section';
	import { Skeleton } from '$hyper-ui/components/skeleton';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Well } from '$hyper-ui/components/well';
	import StateBlock from '$shared/errors/StateBlock.svelte';
	import { claimHandleCommand } from '../application/commands/claim-handle.command';
	import { loadPublishingCommand } from '../application/commands/load-publishing.command';
	import { openExternalUrlCommand } from '../application/commands/open-external-url.command';
	import { signInToPublishCommand } from '../application/commands/sign-in-to-publish.command';
	import { followPublishingHook } from '../application/hooks/follow-publishing.hook';
	import { handleClaimQuery } from '../application/queries/handle-claim.query.svelte';
	import { publishingQuery } from '../application/queries/publishing.query.svelte';
	import { MARKETPLACE_DOCS_URL } from './extensions-view';
	import PublishableRow from './PublishableRow.svelte';

	const listing = $derived(publishingQuery.data);
	const publishing = $derived(listing.publishing);
	const claim = $derived(handleClaimQuery.data);
	const account = $derived(
		publishing?.handle
			? `@${publishing.handle}`
			: publishing?.signedIn
				? 'no handle yet'
				: 'signed out',
	);
	let handle: string = $state('');

	onMount(() => {
		loadPublishingCommand();
		return followPublishingHook();
	});

	function onClaim(event: SubmitEvent): void {
		event.preventDefault();
		claimHandleCommand(handle);
	}
</script>

<PageSection
	title="Published"
	description="Publish an extension from any repository with a malini.json. Malini checks it and puts what is committed on bestboy.dev under your handle."
	testId="extensions-published"
>
	<Well title="Bestboy" note={publishing ? account : undefined}>
		{#snippet trailing()}
			{#if publishing && !publishing.signedIn}
				<Button variant="secondary" size="sm" onclick={() => signInToPublishCommand()}>
					Sign in
				</Button>
			{/if}
		{/snippet}
		{#if publishing?.signedIn && !publishing.handle}
			<form class="flex flex-wrap items-center gap-2 px-3 pb-1.5" onsubmit={onClaim}>
				<TextInput
					bind:value={handle}
					size="xs"
					placeholder="your-handle"
					ariaLabel="Your handle"
					class="w-56"
				/>
				<Button
					type="submit"
					variant="primary"
					size="sm"
					loading={claim.claiming}
					disabled={claim.claiming || handle.trim().length === 0}
				>
					Claim
				</Button>
				{#if claim.problem}
					<p class="text-error-content text-xs" role="alert">{claim.problem}</p>
				{:else}
					<p class="text-fg-tertiary text-xs">You publish under it.</p>
				{/if}
			</form>
		{:else if claim.problem}
			<p class="text-error-content px-3 pb-1.5 text-xs" role="alert">{claim.problem}</p>
		{/if}
	</Well>

	<Well title="Your repositories" note={publishing ? `${publishing.extensions.length}` : undefined}>
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
			<StateBlock
				heading="No repository has a malini.json yet"
				detail="Add one at a repository's root, with skills in skills/<name>/SKILL.md, and it shows here."
			>
				{#snippet action()}
					<Button
						variant="secondary"
						size="sm"
						onclick={() => openExternalUrlCommand(MARKETPLACE_DOCS_URL)}
					>
						How to write one
					</Button>
				{/snippet}
			</StateBlock>
		{:else}
			<ul class="flex flex-col gap-1.5" aria-label="Repositories with an extension">
				{#each publishing.extensions as extension (extension.repositoryId)}
					<li>
						<PublishableRow
							{extension}
							canPublish={publishing.signedIn && publishing.handle !== null}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</Well>
</PageSection>
