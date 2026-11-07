<script lang="ts">
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { Skeleton } from '$hyper-ui/components/skeleton';

	interface Props {
		rows?: number;
	}

	let { rows = 3 }: Props = $props();

	const rowWidths = ['42%', '31%', '48%', '36%', '27%', '39%'];
	const rowIndexes = $derived(Array.from({ length: Math.max(1, rows) }, (_, index) => index));
</script>

<ComposerShell testId="repository-list-skeleton">
	<ul class="flex flex-col p-1" aria-hidden="true">
		{#each rowIndexes as rowIndex (rowIndex)}
			<li class="flex h-8 items-center gap-3 px-2.5">
				<Skeleton shape="rect" width="1rem" height="1rem" />
				<div class="min-w-0 flex-1">
					<Skeleton
						shape="text"
						width={rowWidths[rowIndex % rowWidths.length] ?? '60%'}
						height="0.625rem"
					/>
				</div>
			</li>
		{/each}
	</ul>
</ComposerShell>
