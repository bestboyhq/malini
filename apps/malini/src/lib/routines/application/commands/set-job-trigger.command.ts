import type { JobTrigger } from '$contract/routines';
import { ownRoutineOf, statusSteps } from '$lib/routines/domain/job-trigger';
import type { Routine } from '$lib/routines/domain/routine';
import { jobTriggerActionId } from '$lib/routines/domain/routine-action';
import type { RoutineJob } from '$lib/routines/domain/routine-job';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { publishAutomationRulesCommand } from './publish-automation-rules.command';

export { setJobTriggerCommand };

function setJobTriggerCommand(job: RoutineJob, trigger: JobTrigger | null): void {
	void routineActionsStore.run(jobTriggerActionId(job.id), async () => {
		const own = ownRoutineOf(routinesAggregate.routines, job.id);
		if (trigger === null) {
			if (own === null) return;
			await routinesService.delete(own.id);
			routinesAggregate.removeRoutine(own.id);
			publishAutomationRulesCommand();
			return;
		}
		let routine = await placeTrigger(own, job, trigger.when);
		routinesAggregate.upsertRoutine(routine);
		for (const step of statusSteps(routine.status, trigger.status)) {
			routine =
				step === 'promote'
					? await routinesService.promote(routine.id)
					: await routinesService.demote(routine.id);
			routinesAggregate.upsertRoutine(routine);
		}
		publishAutomationRulesCommand();
	});
}

async function placeTrigger(own: Routine | null, job: RoutineJob, when: string): Promise<Routine> {
	const steps = [{ job: job.id }];
	if (own === null) return routinesService.createDraft({ label: job.name, when, steps });
	if (own.when === when && own.label === job.name) return own;
	return routinesService.update(own.id, { label: job.name, when, steps });
}
