<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { updateInitiativeDependencyCommand } from '$lib/initiatives/application/commands/update-initiative-dependency.command';
	import { updateInitiativeCommand } from '$lib/initiatives/application/commands/update-initiative.command';
	import { initiativesQuery } from '$lib/initiatives/application/queries/initiatives.query.svelte';
	import { noteTarget } from '$lib/initiatives/domain/initiative';
	import { dayName } from './rail-labels';

	type NoteEditor = Readonly<{
		content: string | null;
		label: string;
		placeholder: string;
		onchange: (content: string | null) => void;
	}>;

	interface Props {
		repositoryFullName: string;
		selected: string | null;
		onselect: (id: string | null) => void;
		scratchpad: Snippet;
		editor: Snippet<[NoteEditor]>;
	}

	let { repositoryFullName, selected, onselect, scratchpad, editor }: Props = $props();

	const CRUMB =
		'text-fg-tertiary hover:text-fg-default focus-visible:ring-border-default/50 min-w-0 truncate rounded-sm outline-none focus-visible:ring-2';

	const target = $derived(noteTarget(initiativesQuery.inRepository(repositoryFullName), selected));
</script>

{#if target}
	{@const { initiative, dependency } = target}
	{@const title = dependency?.title ?? initiative.title}
	<section aria-label={`Note on ${title}`}>
		<header class="mb-6">
			<nav class="text-2xs mb-2 flex min-w-0 items-center gap-1" aria-label="Note path">
				<Button bare class={[CRUMB, 'shrink-0']} onclick={() => onselect(null)}>Scratchpad</Button>
				{#if dependency}
					<Icon name="chevron-right" size={12} class="text-fg-quaternary shrink-0" />
					<Button bare class={CRUMB} onclick={() => onselect(initiative.id)}>
						<SensitiveText text={initiative.title} />
					</Button>
				{/if}
			</nav>
			<h2 class="text-fg-default text-xl font-semibold tracking-tight">
				<SensitiveText text={title} />
			</h2>
			<p class="text-fg-tertiary mt-0.5 text-xs">
				{#if dependency}
					Dependency of <SensitiveText text={initiative.title} />
				{:else if initiative.dueOn}
					Outcome, due {dayName(initiative.dueOn)}
				{:else}
					Outcome, no date
				{/if}
			</p>
		</header>
		{#key dependency?.id ?? initiative.id}
			{@render editor({
				content: (dependency ?? initiative).note,
				label: `Note on ${title}`,
				placeholder: dependency ? 'Notes on this dependency' : 'Notes on this outcome',
				onchange: (note) =>
					dependency
						? updateInitiativeDependencyCommand(dependency.id, { note })
						: updateInitiativeCommand(initiative.id, { note }),
			})}
		{/key}
	</section>
{:else}
	{@render scratchpad()}
{/if}
