import { skillUsageAggregate } from '$lib/skills/infrastructure/aggregates/skill-usage.aggregate.svelte';

export { loadSkillUsageCommand };

function loadSkillUsageCommand(): void {
	void skillUsageAggregate.load();
}
