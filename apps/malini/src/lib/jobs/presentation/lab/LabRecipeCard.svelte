<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import type { LabRecipe } from './lab-recipes';
	import { labTrigger, labWhenClause, type LabJobSetup } from './lab-triggers';

	interface Props {
		recipe: LabRecipe;
		onuse: () => void;
	}

	let { recipe, onuse }: Props = $props();

	const setup = $derived<LabJobSetup>({ triggerId: recipe.triggerId, mode: 'auto' });
</script>

<article
	class="border-surface-50-border bg-surface-50 flex w-full flex-col gap-3 rounded-xl border-[0.5px] p-4"
	aria-label={recipe.title}
>
	<div class="flex min-w-0 items-center gap-2">
		<span
			class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
			aria-hidden="true"
		>
			<Icon name={labTrigger(setup).icon} size={13} />
		</span>
		<span class="text-fg-tertiary min-w-0 truncate text-xs">{labWhenClause(setup)}</span>
	</div>
	<div class="flex flex-col gap-1">
		<h3 class="text-fg-default truncate text-sm font-semibold">{recipe.title}</h3>
		<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">{recipe.description}</p>
	</div>
	<div class="mt-auto">
		<Button variant="secondary" size="sm" ariaLabel={`Use ${recipe.title}`} onclick={onuse}>
			Use
		</Button>
	</div>
</article>
