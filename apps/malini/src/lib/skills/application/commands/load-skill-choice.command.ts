import { skillChoicesAggregate } from '$lib/skills/infrastructure/aggregates/skill-choices.aggregate.svelte';

export { loadSkillChoiceCommand };

function loadSkillChoiceCommand(workstreamId: string, sessionId: string | null): void {
	void (async () => {
		try {
			await skillChoicesAggregate.load(workstreamId, sessionId);
		} catch (error) {
			console.error('[malini skills] could not load the skills of this chat', error);
		}
	})();
}
