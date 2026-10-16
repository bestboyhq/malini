import type { SkillPresetRecord } from '$contract/skills';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

class SkillPresetsAggregate {
	presets = $state.raw<readonly SkillPresetRecord[]>([]);
	loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		if (this.loadState !== 'ready') this.loadState = 'loading';
		try {
			const presets = await skillsService.listPresets();
			if (generation !== this.#generation) return;
			this.presets = presets;
			this.loadState = 'ready';
		} catch (error) {
			if (generation !== this.#generation) return;
			this.loadState = 'error';
			throw error;
		}
	}

	replaceAll(presets: readonly SkillPresetRecord[]): void {
		this.#generation += 1;
		this.presets = presets;
	}

	upsert(preset: SkillPresetRecord): void {
		this.#generation += 1;
		const known = this.presets.some(({ id }) => id === preset.id);
		this.presets = known
			? this.presets.map((existing) => (existing.id === preset.id ? preset : existing))
			: [...this.presets, preset];
	}

	remove(presetId: string): void {
		this.#generation += 1;
		this.presets = this.presets.filter(({ id }) => id !== presetId);
	}

	find(presetId: string): SkillPresetRecord | null {
		return this.presets.find(({ id }) => id === presetId) ?? null;
	}
}

export const skillPresetsAggregate = new SkillPresetsAggregate();
