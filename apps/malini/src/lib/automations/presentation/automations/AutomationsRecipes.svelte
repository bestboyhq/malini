<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { goto } from '$shared/router/navigation';
	import { AUTOMATIONS_HREF } from '$shared/router/routes-hrefs';
	import { automationsState } from './automations-state.svelte';
	import { PageSection } from '$hyper-ui/components/page-section';
	import RecipeCard from './RecipeCard.svelte';
	import { RECIPES, type Recipe } from './recipes';

	function onUse(recipe: Recipe): void {
		automationsState.startDraft(recipe.sentence);
		void goto(AUTOMATIONS_HREF);
	}
</script>

<PageSection
	title="Recipes"
	description="Ready-made automations. Use one and Malini drafts it, then you make it yours."
	testId="automations-recipes"
>
	<Well title="All recipes" note={`${RECIPES.length}`}>
		<ul class="grid grid-cols-1 gap-1.5 @2xl:grid-cols-3">
			{#each RECIPES as recipe (recipe.id)}
				<li class="flex">
					<RecipeCard {recipe} onuse={() => onUse(recipe)} />
				</li>
			{/each}
		</ul>
	</Well>
</PageSection>
