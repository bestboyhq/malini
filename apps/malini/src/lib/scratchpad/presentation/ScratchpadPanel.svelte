<script lang="ts">
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import type { ScratchpadStart } from '$lib/scratchpad/domain/scratchpad';
	import Scratchpad from './Scratchpad.svelte';

	interface Props {
		repositoryFullName: string;
		onstartworkstream: (start: ScratchpadStart) => void;
	}

	let { repositoryFullName, onstartworkstream }: Props = $props();
</script>

<ScrollableDiv class="h-full w-full" ariaLabel={`Notes for ${repositoryFullName}`}>
	<div class="py-6 pr-6 pl-12">
		<Scratchpad {repositoryFullName} {onstartworkstream} />
	</div>
</ScrollableDiv>
