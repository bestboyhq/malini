<script lang="ts">
	import { Well } from '$hyper-ui/components/well';
	import { LAB_RECIPES } from './lab-recipes';
	import { labState } from './lab-state.svelte';
	import LabRecipeCard from './LabRecipeCard.svelte';
	import LabSection from './LabSection.svelte';
</script>

<LabSection
	title="Recipes"
	description="Ready-made jobs. Use one and Malini drafts it, then you make it yours."
	testId="lab-recipes-page"
>
	<Well title="All recipes" note={`${LAB_RECIPES.length}`}>
		<ul class="grid grid-cols-1 gap-1.5 @2xl:grid-cols-3">
			{#each LAB_RECIPES as recipe (recipe.id)}
				<li class="flex">
					<LabRecipeCard {recipe} onuse={() => labState.startDraft(recipe.sentence)} />
				</li>
			{/each}
		</ul>
	</Well>
</LabSection>
