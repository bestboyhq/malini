import type { ShutdownImpact } from '$contract/system';

export interface ShutdownImpactLine {
	key: keyof ShutdownImpact;
	count: number;
	noun: string;
	consequence: string;
}

interface ImpactCopy {
	key: keyof ShutdownImpact;
	singular: string;
	plural: string;
	consequence: string;
	pluralConsequence: string;
}

const IMPACT_COPY: readonly ImpactCopy[] = [
	{
		key: 'agentRuns',
		singular: 'agent run',
		plural: 'agent runs',
		consequence: 'stops mid-turn',
		pluralConsequence: 'stop mid-turn',
	},
	{
		key: 'containers',
		singular: 'container',
		plural: 'containers',
		consequence: 'is stopped and removed',
		pluralConsequence: 'are stopped and removed',
	},
];

export function shutdownImpactLines(impact: ShutdownImpact): readonly ShutdownImpactLine[] {
	return IMPACT_COPY.filter((row) => impact[row.key] > 0).map((row) => {
		const count = impact[row.key];
		const plural = count !== 1;
		return {
			key: row.key,
			count,
			noun: plural ? row.plural : row.singular,
			consequence: plural ? row.pluralConsequence : row.consequence,
		};
	});
}
