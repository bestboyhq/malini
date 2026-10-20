<script lang="ts">
	import { sameAppearance, type Appearance } from '$lib/app/domain/appearance';
	import type { Look } from '$lib/app/domain/look';
	import GreySwatch from './GreySwatch.svelte';

	interface Props {
		looks: readonly Look[];
		current: Appearance;
		onchoose: (look: Look) => void;
	}

	let { looks, current, onchoose }: Props = $props();

	const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
	const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

	function savedLabel(savedAt: number): string {
		const saved = new Date(savedAt);
		const today = saved.toDateString() === new Date().toDateString();
		return today ? TIME.format(saved) : DAY.format(saved);
	}
</script>

<div class="@container">
	<div class="grid grid-cols-5 gap-2 px-2 pt-0.5 pb-2.5 @2xl:grid-cols-10">
		{#each looks as look (look.savedAt)}
			<GreySwatch
				appearance={look.appearance}
				label={savedLabel(look.savedAt)}
				pressed={sameAppearance(look.appearance, current)}
				onchoose={() => onchoose(look)}
			/>
		{/each}
	</div>
</div>
