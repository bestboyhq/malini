import {
	DEFAULT_SKILL_CHOICE,
	resolveSkillChoice,
	skillChoiceKey,
	toggleSkill,
} from '$lib/skills/domain/skill-choice';
import { skillCatalogAggregate } from '$lib/skills/infrastructure/aggregates/skill-catalog.aggregate.svelte';
import { skillChoicesAggregate } from '$lib/skills/infrastructure/aggregates/skill-choices.aggregate.svelte';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { chooseSkillsCommand } from './choose-skills.command';

export { toggleChatSkillCommand };

function toggleChatSkillCommand(
	workstreamId: string,
	sessionId: string | null,
	skill: string,
): void {
	const choice =
		skillChoicesAggregate.choices.get(skillChoiceKey(workstreamId, sessionId)) ??
		DEFAULT_SKILL_CHOICE;
	const { skills } = resolveSkillChoice(choice, skillPresetsAggregate.presets);
	const available = skillCatalogAggregate.catalog(workstreamId).skills.map(({ name }) => name);
	chooseSkillsCommand(workstreamId, sessionId, {
		kind: 'custom',
		skills: toggleSkill(skills, available, skill),
	});
}
