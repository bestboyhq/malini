<script lang="ts">
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { LAB_RECIPES } from './lab-recipes';
	import { labState } from './lab-state.svelte';
	import LabRecipeCard from './LabRecipeCard.svelte';
</script>

<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Recipes">
	<div
		class="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-10 pt-12 pb-16"
		data-testid="lab-recipes-page"
	>
		<header>
			<h1 class="text-fg-default text-2xl font-semibold tracking-tight">Recipes</h1>
			<p class="text-fg-tertiary mt-1 text-sm">
				Ready-made jobs. Use one and Malini drafts it, then you make it yours.
			</p>
		</header>
		<ul class="grid grid-cols-3 gap-3">
			{#each LAB_RECIPES as recipe (recipe.id)}
				<li class="flex">
					<LabRecipeCard {recipe} onuse={() => labState.startDraft(recipe.sentence)} />
				</li>
			{/each}
		</ul>
	</div>
</ScrollableDiv>
