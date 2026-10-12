import type { AgentReasoningEffort } from '$contract/agent';
import type { JobDefinitionRecord, JobOutput, JobRunsIn } from '$contract/jobs';

export const JOB_RUNS_IN_OPTIONS: readonly Readonly<{ value: JobRunsIn; label: string }>[] = [
	{ value: 'workstream', label: 'This workstream' },
	{ value: 'new-workstream', label: 'New workstream' },
];

export const JOB_OUTPUT_OPTIONS: readonly Readonly<{ value: JobOutput; label: string }>[] = [
	{ value: 'none', label: 'None' },
	{ value: 'draft', label: 'Draft PR' },
	{ value: 'merge', label: 'Queue merge' },
];

const RUNS_IN_SUMMARY: Readonly<Record<JobRunsIn, string>> = {
	workstream: 'runs in a workstream you pick',
	'new-workstream': 'runs in a new workstream',
};

const OUTPUT_SUMMARY: Readonly<Record<JobOutput, string>> = {
	none: 'leaves the changes for you',
	draft: 'opens a draft PR',
	merge: 'queues the merge',
};

export function effortLabel(effort: AgentReasoningEffort): string {
	if (effort === 'xhigh') return 'Extra high';
	return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

export function jobShapeSummary(
	definition: Pick<JobDefinitionRecord, 'runsIn' | 'output' | 'builtin'>,
): string {
	if (definition.builtin !== null) return 'the merge queue runs it in the queued workstream';
	return `${RUNS_IN_SUMMARY[definition.runsIn]}, ${OUTPUT_SUMMARY[definition.output]}`;
}

export function instructionsPreview(instructions: string): string {
	const [firstParagraph = ''] = instructions.trim().split(/\n\s*\n/u);
	return firstParagraph.replaceAll(/\s+/gu, ' ');
}
