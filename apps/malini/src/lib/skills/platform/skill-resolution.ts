import type { SkillChoice } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { DEFAULT_SKILL_CHOICE, resolveSkillChoice } from '../domain/skill-choice';
import { getSkillChoice, setSkillChoice } from './skill-choices.repository';
import { listSkillPresets } from './skill-presets.repository';

export function effectiveSkillChoice(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string | null,
): SkillChoice {
	const ofSession = sessionId === null ? null : getSkillChoice(db, 'session', sessionId);
	if (ofSession !== null && ofSession.kind !== 'default') return ofSession;
	return getSkillChoice(db, 'workstream', workstreamId) ?? DEFAULT_SKILL_CHOICE;
}

export function skillsForRun(
	db: MaliniDatabase,
	workstreamId: string,
	sessionId: string,
): readonly string[] | null {
	const choice = effectiveSkillChoice(db, workstreamId, sessionId);
	const { skills } = resolveSkillChoice(choice, listSkillPresets(db));
	return skills === 'all' ? null : skills;
}

export function chooseSessionSkills(
	db: MaliniDatabase,
	sessionId: string,
	choice: SkillChoice,
): void {
	setSkillChoice(db, 'session', sessionId, choice);
}
