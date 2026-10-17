import type { SkillUsageReport } from '$contract/skills';
import type { SkillUsage } from '$lib/skills/domain/skill-usage';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

const IDLE: SkillUsage = { report: null, state: 'idle', error: null };

class SkillUsageAggregate {
	usage = $state.raw<SkillUsage>(IDLE);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		if (this.usage.state !== 'ready') this.usage = { ...this.usage, state: 'loading' };
		try {
			const report = await skillsService.usage();
			if (generation !== this.#generation) return;
			this.usage = { report, state: 'ready', error: null };
		} catch (error) {
			if (generation !== this.#generation) return;
			const message = error instanceof Error ? error.message : String(error);
			this.usage = { ...this.usage, state: 'error', error: message };
		}
	}

	replace(report: SkillUsageReport): void {
		this.#generation += 1;
		this.usage = { report, state: 'ready', error: null };
	}
}

export const skillUsageAggregate = new SkillUsageAggregate();
