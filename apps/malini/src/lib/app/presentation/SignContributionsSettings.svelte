<script lang="ts">
	import { onMount } from 'svelte';
	import { Switch } from '$hyper-ui/components/switch';
	import { loadSignContributionsCommand } from '$lib/app/application/commands/load-sign-contributions.command';
	import { signContributionsCommand } from '$lib/app/application/commands/sign-contributions.command';
	import { signContributionsQuery } from '$lib/app/application/queries/sign-contributions.query.svelte';

	const labelId = $props.id();

	onMount(loadSignContributionsCommand);
</script>

<div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3">
	<div class="min-w-0">
		<h3 id={labelId} class="text-fg-default text-sm font-medium">Sign contributions</h3>
		<p class="text-fg-tertiary text-xs">
			Malini adds itself as co-author on its commits and folds 🧑‍🍳 Cooked with Malini under each pull
			request it opens: your profile and how many agents worked on it. Work repositories may
			disagree.
		</p>
	</div>
	<Switch
		checked={signContributionsQuery.signed ?? false}
		disabled={signContributionsQuery.signed === null}
		labelledBy={labelId}
		onchange={signContributionsCommand}
	/>
</div>
