import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';

export { loadSkillPresetsCommand };

function loadSkillPresetsCommand(): void {
	void (async () => {
		try {
			await skillPresetsAggregate.load();
		} catch (error) {
			console.error('[malini skills] could not load skill presets', error);
		}
	})();
}
