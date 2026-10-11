<script lang="ts">
	import type { ViewSnapshot } from '../settings/settings-origin';

	interface Props {
		view: ViewSnapshot;
	}

	let { view }: Props = $props();

	let frameWidth = $state(0);
	const scale = $derived(frameWidth / view.width);

	function host(node: HTMLElement): () => void {
		return view.mount(node);
	}
</script>

<div
	class="border-border-default bg-surface-root relative overflow-hidden rounded-xl border-[0.5px] shadow-xs"
	style:aspect-ratio="{view.width} / {view.height}"
	bind:clientWidth={frameWidth}
	aria-hidden="true"
	inert
>
	<div
		class="pointer-events-none absolute top-0 left-0 origin-top-left"
		style:width="{view.width}px"
		style:height="{view.height}px"
		style:transform="scale({scale})"
		{@attach host}
	>
		<div class="absolute top-[13px] left-3 z-[60] flex gap-[9px]">
			<span class="bg-surface-150 size-3.5 rounded-full"></span>
			<span class="bg-surface-150 size-3.5 rounded-full"></span>
			<span class="bg-surface-150 size-3.5 rounded-full"></span>
		</div>
	</div>
</div>
