<script lang="ts">
	import type { AutomaticJobBuiltin, JobExperimentRecord, JobOutputRecord } from '$contract/jobs';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { jobOutputIssues } from '$lib/jobs/domain/job-output-checks';
	import { JOB_OUTPUT_NOUN } from './job-insights-copy';

	interface Props {
		builtin: AutomaticJobBuiltin;
		sample: readonly JobOutputRecord[];
		experiments: readonly JobExperimentRecord[];
		selectedId: string | null;
	}

	let { builtin, sample, experiments, selectedId }: Props = $props();

	function resultFor(
		experiment: JobExperimentRecord,
		outputId: string,
	): Readonly<{ text: string; issues: readonly string[]; error: string | null }> | null {
		const result = experiment.results.find((entry) => entry.outputId === outputId);
		if (!result) return null;
		return {
			text: result.output ?? `No ${JOB_OUTPUT_NOUN[builtin].one}`,
			issues: jobOutputIssues(builtin, result.output),
			error: result.error,
		};
	}
</script>

<div class="border-surface-50-border bg-surface-50 overflow-hidden rounded-xl border-[0.5px]">
	<table class="w-full table-fixed text-xs">
		<thead>
			<tr class="text-fg-tertiary text-left">
				<th scope="col" class="w-[22%] px-3 py-2 font-normal">Task</th>
				{#each experiments as experiment (experiment.id)}
					<th scope="col" class="px-3 py-2 font-normal">{experiment.name}</th>
				{/each}
			</tr>
		</thead>
		<tbody class="divide-surface-50-border divide-y-[0.5px]">
			{#each sample as output (output.id)}
				<tr>
					<th scope="row" class="text-fg-tertiary truncate px-3 py-2 text-left font-normal">
						{output.excerpt}
					</th>
					{#each experiments as experiment (experiment.id)}
						{@const result = resultFor(experiment, output.id)}
						<td
							class={[
								'px-3 py-2',
								experiment.id === selectedId
									? 'bg-surface-50-selected text-fg-default'
									: 'text-fg-secondary',
							]}
						>
							{#if result}
								<span class="flex min-w-0 items-center gap-1.5">
									<span class="truncate">{result.text}</span>
									{#if result.issues.length > 0}
										<Tooltip content={result.error ?? result.issues.join(', ')} placement="top">
											<span
												class="text-warning-content flex shrink-0"
												role="img"
												aria-label={`Breaks a rule: ${result.issues.join(', ')}`}
											>
												<Icon name="alert" size={12} />
											</span>
										</Tooltip>
									{/if}
								</span>
							{:else}
								<span class="text-fg-tertiary">{experiment.running ? '…' : '–'}</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
