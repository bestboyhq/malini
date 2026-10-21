import { isSkillNameList } from '$contract/skills';
import type { MaliniDatabase } from '$main/db/driver';
import { get, nowIso8601, parseJsonColumn, run } from '$main/db/rows';

export function skillsForRun(db: MaliniDatabase, sessionId: string): readonly string[] | null {
	const row = get<{ choice: string }>(
		db,
		"SELECT choice FROM skill_choices WHERE scope = 'session' AND owner_id = ?",
		sessionId,
	);
	const skills = row ? parseJsonColumn(row.choice) : null;
	return isSkillNameList(skills) && skills.length > 0 ? skills : null;
}

export function chooseSessionSkills(
	db: MaliniDatabase,
	sessionId: string,
	skills: readonly string[],
): void {
	run(
		db,
		`INSERT INTO skill_choices (scope, owner_id, choice, updated_at) VALUES ('session', ?, ?, ?)
		 ON CONFLICT (scope, owner_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`,
		sessionId,
		JSON.stringify(skills),
		nowIso8601(),
	);
}
