import type { JobDefinitionRecord } from '$contract/jobs';
import { LAB_LOCAL_JOB_PREFIX } from './lab-state.svelte';
import { labIsManual, type LabJobSetup } from './lab-triggers';

export function labWaitingJobs(
	jobs: readonly JobDefinitionRecord[],
	setupOf: (definition: JobDefinitionRecord) => LabJobSetup,
	dismissed: readonly string[],
): readonly JobDefinitionRecord[] {
	return jobs.filter((job) => {
		const setup = setupOf(job);
		return (
			setup.mode === 'ask' &&
			!labIsManual(setup) &&
			!dismissed.includes(job.id) &&
			!job.id.startsWith(LAB_LOCAL_JOB_PREFIX)
		);
	});
}
