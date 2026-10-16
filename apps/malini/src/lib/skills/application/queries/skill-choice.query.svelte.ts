import type { SkillChoice } from '$contract/skills';
import { DEFAULT_SKILL_CHOICE, skillChoiceKey } from '$lib/skills/domain/skill-choice';
import { skillChoicesAggregate } from '$lib/skills/infrastructure/aggregates/skill-choices.aggregate.svelte';

export { skillChoiceQuery };

class SkillChoiceQuery {
	public readonly data: (workstreamId: string, sessionId: string | null) => SkillChoice = $derived(
		(workstreamId: string, sessionId: string | null) =>
			skillChoicesAggregate.choices.get(skillChoiceKey(workstreamId, sessionId)) ??
			DEFAULT_SKILL_CHOICE,
	);
}

const skillChoiceQuery = new SkillChoiceQuery();
