<script lang="ts">
	import { Skeleton } from '$hyper-ui/components/skeleton';

	interface Props {
		groups?: number;
		label?: string;
	}

	let { groups = 2, label = 'Loading repositories' }: Props = $props();

	const groupIndexes = $derived(Array.from({ length: Math.max(1, groups) }, (_, index) => index));
	const workstreamWidths = ['62%', '44%', '54%'];
</script>

<div
	class="flex w-full flex-col gap-3 pt-2"
	role="status"
	aria-label={label}
	aria-busy="true"
	data-testid="repository-sidebar-skeleton"
>
	{#each groupIndexes as groupIndex (groupIndex)}
		<div class="flex w-full flex-col gap-0.5" aria-hidden="true">
			<div class="flex h-8 w-full items-center gap-2 px-2">
				<Skeleton shape="rect" width="0.9375rem" height="0.9375rem" ariaLabel={label} />
				<Skeleton
					shape="text"
					width={groupIndex === 0 ? '58%' : '46%'}
					height="0.5rem"
					ariaLabel={label}
				/>
			</div>
			{#each workstreamWidths.slice(0, groupIndex === 0 ? 3 : 2) as width, rowIndex (rowIndex)}
				<div class="flex h-8 w-full items-center gap-1.5 pr-9 pl-[14px]">
					<Skeleton shape="rect" width="0.8125rem" height="0.8125rem" ariaLabel={label} />
					<Skeleton shape="text" {width} height="0.5rem" ariaLabel={label} />
				</div>
			{/each}
		</div>
	{/each}
</div>
