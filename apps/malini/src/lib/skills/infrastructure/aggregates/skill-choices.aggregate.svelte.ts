import type { SkillChoice } from '$contract/skills';
import { skillChoiceKey } from '$lib/skills/domain/skill-choice';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

class SkillChoicesAggregate {
	choices = $state.raw<ReadonlyMap<string, SkillChoice>>(new Map());

	#generations = new Map<string, number>();

	async load(workstreamId: string, sessionId: string | null): Promise<void> {
		const key = skillChoiceKey(workstreamId, sessionId);
		const generation = this.#bump(key);
		const choice = await skillsService.choice(workstreamId, sessionId);
		if (this.#generations.get(key) === generation) this.#set(key, choice);
	}

	async choose(workstreamId: string, sessionId: string | null, choice: SkillChoice): Promise<void> {
		const key = skillChoiceKey(workstreamId, sessionId);
		const previous = this.choices.get(key);
		const generation = this.#bump(key);
		this.#set(key, choice);
		try {
			const saved = await skillsService.choose(workstreamId, sessionId, choice);
			if (this.#generations.get(key) === generation) this.#set(key, saved);
		} catch (error) {
			if (this.#generations.get(key) === generation && previous) this.#set(key, previous);
			throw error;
		}
	}

	#bump(key: string): number {
		const generation = (this.#generations.get(key) ?? 0) + 1;
		this.#generations.set(key, generation);
		return generation;
	}

	#set(key: string, choice: SkillChoice): void {
		const next = new Map(this.choices);
		next.set(key, choice);
		this.choices = next;
	}
}

export const skillChoicesAggregate = new SkillChoicesAggregate();
