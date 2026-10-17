import type { SkillChoice } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { resolveSkillChoice } from '../domain/skill-choice';
import { getSessionSkillChoice, setSessionSkillChoice } from './skill-choices.repository';
import { listSkillPresets } from './skill-presets.repository';

export function skillsForRun(db: MaliniDatabase, sessionId: string): readonly string[] | null {
	const choice = getSessionSkillChoice(db, sessionId);
	if (choice === null) return null;
	const { skills } = resolveSkillChoice(choice, listSkillPresets(db));
	return skills === 'all' ? null : skills;
}

export function chooseSessionSkills(
	db: MaliniDatabase,
	sessionId: string,
	choice: SkillChoice,
): void {
	setSessionSkillChoice(db, sessionId, choice);
}
