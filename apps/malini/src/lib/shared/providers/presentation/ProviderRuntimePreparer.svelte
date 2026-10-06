<script lang="ts">
	import { onMount } from 'svelte';
	import { loadModelDefaultsCommand } from '$shared/providers/application/commands/load-model-defaults.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';

	onMount(() => {
		loadModelDefaultsCommand();
		loadProviderCapabilitiesCommand();
	});
</script>
