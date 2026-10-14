<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { disarmOnDismiss } from '$shared/shell/armed-confirmation';
	import { workstreamNativeExistenceQuery } from '$shared/repositories/application/queries/workstream-native-existence.query.svelte';
	import type { Repository } from '$shared/repositories/domain/repository';
	import type { Workstream } from '$shared/repositories/domain/workstream';
	import { workstreamCount } from '$shared/repositories/domain/workstream-retirement';

	interface Props {
		repository: Repository;
		workstreams: readonly Workstream[];
		onremove: ((repository: Repository, workstreams: readonly Workstream[]) => void) | undefined;
		placement: 'right' | 'top';
		restingClass?: ClassValue;
		testId: string;
	}

	let { repository, workstreams, onremove, placement, restingClass, testId }: Props = $props();

	let armedForCount = $state<number | null>(null);
	const nativeExistence = $derived(workstreamNativeExistenceQuery.data);
	const armed = $derived(armedForCount === workstreams.length);
	const blocked = $derived(
		workstreams.some((workstream) => nativeExistence(workstream.id) === 'in-flight'),
	);
	const removal = $derived.by(() => {
		const count = workstreams.length;
		const listed = workstreamCount(count);
		if (!armed) {
			return {
				label: '',
				ariaLabel: `Remove ${repository.fullName}`,
				tooltip: blocked
					? 'Still setting up a workstream. Remove the repository once setup finishes or fails.'
					: 'Remove repository',
			};
		}
		if (count === 0) {
			return {
				label: 'Confirm remove',
				ariaLabel: `Confirm remove ${repository.fullName}`,
				tooltip: `Removes ${repository.fullName}. Escape cancels it`,
			};
		}
		return {
			label: `Delete ${count} and remove`,
			ariaLabel: `Delete ${listed} and remove ${repository.fullName}`,
			tooltip: `Deletes ${listed} with their work saved in git, then removes ${repository.fullName}. Escape cancels it`,
		};
	});

	$effect(() => {
		if (!armed) return;
		return disarmOnDismiss(() => (armedForCount = null));
	});

	function requestRemoval(): void {
		if (!armed) {
			armedForCount = workstreams.length;
			return;
		}
		armedForCount = null;
		onremove?.(repository, workstreams);
	}
</script>

<Tooltip content={removal.tooltip} {placement}>
	<Button
		variant={armed ? 'danger' : 'ghost'}
		size="sm"
		iconOnly={!armed}
		class={[!armed && restingClass]}
		disabled={!onremove || blocked}
		ariaLabel={removal.ariaLabel}
		data-armed={armed ? '' : undefined}
		data-testid={testId}
		onclick={requestRemoval}
	>
		{#if armed}
			{removal.label}
		{:else}
			<Icon name="trash" size={14} />
		{/if}
	</Button>
</Tooltip>
