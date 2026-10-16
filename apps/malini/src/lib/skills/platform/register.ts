import type { MainContext } from '$main/context';
import { defineSkillCommands, type SkillsDeps } from './commands';

export function registerSkills(context: MainContext, deps: SkillsDeps): void {
	defineSkillCommands(context, deps);
}
