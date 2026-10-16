import type { SkillChoice } from '$contract/skills';
import { toast } from '$hyper-ui/components/toast';
import { skillChoicesAggregate } from '$lib/skills/infrastructure/aggregates/skill-choices.aggregate.svelte';

export { chooseSkillsCommand };

function chooseSkillsCommand(
	workstreamId: string,
	sessionId: string | null,
	choice: SkillChoice,
): void {
	void (async () => {
		try {
			await skillChoicesAggregate.choose(workstreamId, sessionId, choice);
		} catch (error) {
			toast.error(
				`Could not change the skills of this chat · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
