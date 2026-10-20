<script lang="ts">
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Button } from '$hyper-ui/components/button';
	import {
		Select,
		flattenSelectOptions,
		type SelectItem,
		type SelectOption,
	} from '$hyper-ui/components/select';
	import {
		checkedOutWorkstreamsQuery,
		connectedRepositoriesQuery,
		connectedRepositoryContexts,
		displayWorkstreamName,
	} from '$shared/repositories/repositories.api';
	import { runJobCommand } from '$lib/jobs/application/commands/run-job.command';

	interface Props {
		definition: JobDefinitionRecord;
		onclose: () => void;
	}

	let { definition, onclose }: Props = $props();

	let chosen = $state('');

	const repositories = $derived(
		connectedRepositoryContexts({
			repositories: connectedRepositoriesQuery.data,
			workstreams: checkedOutWorkstreamsQuery.data,
		}),
	);
	const inWorkstream = $derived(definition.runsIn === 'workstream');
	const options: SelectItem[] = $derived(
		inWorkstream
			? repositories
					.map((context) => ({
						label: context.repo.fullName,
						options: context.workstreams.map((workstream) => ({
							value: workstream.id,
							label: displayWorkstreamName(workstream, context.repo.fullName),
						})),
					}))
					.filter((group) => group.options.length > 0)
			: repositories.map((context): SelectOption => ({
					value: context.repo.id,
					label: context.repo.fullName,
				})),
	);
	const values = $derived(flattenSelectOptions(options).map((option) => option.value));
	const target = $derived(values.includes(chosen) ? chosen : (values[0] ?? ''));

	function onRun(): void {
		if (!target) return;
		runJobCommand(
			inWorkstream
				? { definitionId: definition.id, workstreamId: target }
				: { definitionId: definition.id, repositoryId: target },
		);
		onclose();
	}
</script>

<div
	class="border-surface-50-border mt-3 border-t pt-3"
	role="group"
	aria-label={`Run ${definition.name}`}
	data-testid="job-run-target"
>
	{#if values.length === 0}
		<div class="flex items-center gap-2">
			<p class="text-fg-tertiary min-w-0 flex-1 text-xs">
				{inWorkstream
					? 'No workstream is checked out yet. Start one from a repository first.'
					: 'No repository has a checkout yet. Start a workstream in one first.'}
			</p>
			<Button variant="ghost" size="sm" onclick={onclose}>Close</Button>
		</div>
	{:else}
		<div class="flex items-end gap-2">
			<Select
				class="min-w-0 flex-1"
				label={inWorkstream ? 'Workstream' : 'Repository'}
				value={target}
				{options}
				onchange={(value) => (chosen = value)}
			/>
			<Button variant="primary" size="lg" onclick={onRun}>Run job</Button>
			<Button variant="ghost" size="lg" onclick={onclose}>Cancel</Button>
		</div>
	{/if}
</div>
