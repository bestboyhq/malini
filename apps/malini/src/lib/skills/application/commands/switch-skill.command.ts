import { toast } from '$hyper-ui/components/toast';
import { switchedReport, type SkillUsageRow } from '$lib/skills/domain/skill-usage';
import { skillUsageAggregate } from '$lib/skills/infrastructure/aggregates/skill-usage.aggregate.svelte';
import { skillsService } from '$lib/skills/infrastructure/services/skills.service';

export { switchSkillCommand };

function switchSkillCommand(
	row: Pick<SkillUsageRow, 'kind' | 'name' | 'switchName'>,
	on: boolean,
): void {
	const previous = skillUsageAggregate.usage.report;
	const name = row.switchName;
	if (previous === null || name === null) return;
	skillUsageAggregate.replace(switchedReport(previous, row, on));
	void (async () => {
		try {
			skillUsageAggregate.replace(await skillsService.switchSkill({ kind: row.kind, name, on }));
		} catch (error) {
			skillUsageAggregate.replace(previous);
			toast.error(
				`Could not turn ${row.name} ${on ? 'on' : 'off'} · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
