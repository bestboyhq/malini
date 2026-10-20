import type { SkillRecord } from '$contract/skills';

export type SkillCatalog = Readonly<{
	skills: readonly SkillRecord[];
	state: 'idle' | 'loading' | 'ready' | 'error';
	error: string | null;
}>;
