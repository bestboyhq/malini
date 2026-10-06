<script lang="ts" module>
	export const FixtureLayoutInstances = { count: 0 };
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const instance = ++FixtureLayoutInstances.count;
</script>

<section data-testid="fixture-layout" data-instance={instance}>
	{@render children()}
</section>
