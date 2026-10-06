<script lang="ts">
	import { Skeleton } from '$hyper-ui/components/skeleton';

	interface Props {
		rows?: number;
	}

	let { rows = 3 }: Props = $props();

	const rowWidths = ['42%', '31%', '48%', '36%', '27%', '39%'];
	const rowIndexes = $derived(Array.from({ length: Math.max(1, rows) }, (_, index) => index));
</script>

<ul
	class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-2xl border-[0.5px]"
	aria-hidden="true"
	data-testid="repository-list-skeleton"
>
	{#each rowIndexes as rowIndex (rowIndex)}
		<li class="flex h-16 items-center gap-3 px-4">
			<Skeleton shape="rect" width="1.75rem" height="1.75rem" />
			<div class="flex min-w-0 flex-1 flex-col gap-2">
				<Skeleton
					shape="text"
					width={rowWidths[rowIndex % rowWidths.length] ?? '60%'}
					height="0.625rem"
				/>
				<Skeleton shape="text" width="22%" height="0.5rem" />
			</div>
			<Skeleton shape="rect" width="4rem" height="1.5rem" />
		</li>
	{/each}
</ul>
