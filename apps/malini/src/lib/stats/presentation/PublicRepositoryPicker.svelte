<script lang="ts">
	import { onMount } from 'svelte';
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import { RepositoryAvatar } from '$shared/repositories/repositories.api';
	import { loadPublicRepositoriesCommand } from '$lib/stats/application/commands/load-public-repositories.command';
	import { pickRepositoriesCommand } from '$lib/stats/application/commands/pick-repositories.command';
	import { publicRepositoriesQuery } from '$lib/stats/application/queries/public-repositories.query.svelte';
	import { formatCount } from './stats-format';

	interface Props {
		picked: readonly string[];
	}

	let { picked }: Props = $props();

	const MAX_PICKS = 10;

	const repositories = $derived(publicRepositoriesQuery.data);
	const pickedNames = $derived(new Set(picked.map((name) => name.toLowerCase())));
	const headingId = $props.id();

	onMount(loadPublicRepositoriesCommand);

	function isPicked(fullName: string): boolean {
		return pickedNames.has(fullName.toLowerCase());
	}

	function onPick(fullName: string, on: boolean): void {
		const others = picked.filter((name) => name.toLowerCase() !== fullName.toLowerCase());
		pickRepositoriesCommand(on ? [...others, fullName] : others);
	}
</script>

<section class="px-4 py-3" aria-labelledby={headingId}>
	<h3 id={headingId} class="text-fg-default text-sm font-medium">Public repositories</h3>
	<p class="text-fg-tertiary text-xs">
		Name up to {MAX_PICKS} public repositories on your profile. The rest count only toward totals, as
		public or private.
	</p>
	{#if repositories === null}
		<p class="text-fg-tertiary mt-2 text-xs">
			Asking GitHub which of your repositories are public…
		</p>
	{:else if repositories.length === 0}
		<p class="text-fg-tertiary mt-2 text-xs">
			None of the repositories you ran agents in are public on GitHub.
		</p>
	{:else}
		<ul class="-mx-1.5 mt-2 flex flex-col" aria-labelledby={headingId}>
			{#each repositories as repository (repository.fullName)}
				<li>
					<Checkbox
						checked={isPicked(repository.fullName)}
						disabled={!isPicked(repository.fullName) && pickedNames.size >= MAX_PICKS}
						description={`${formatCount(repository.runs)} ${repository.runs === 1 ? 'run' : 'runs'}`}
						onchange={(on) => onPick(repository.fullName, on)}
					>
						{#snippet label()}
							<span class="inline-flex max-w-full items-center gap-1.5 align-top">
								<RepositoryAvatar fullName={repository.fullName} size={16} />
								<span class="truncate">{repository.fullName}</span>
							</span>
						{/snippet}
					</Checkbox>
				</li>
			{/each}
		</ul>
	{/if}
</section>
