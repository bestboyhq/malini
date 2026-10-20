<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { id?: string; label?: string; class?: string; children: Snippet };

	let { id, label, class: className = '', children }: Props = $props();
</script>

<section {id} class="band" aria-labelledby={label}>
	<div class="frame">
		<div class="rail {className}">
			{@render children()}
		</div>
	</div>
</section>
