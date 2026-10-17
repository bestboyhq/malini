import type { ResourceItem, ResourceUsage } from '$contract/stats';

export const DOCKER_STATS_FORMAT = '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}';

export interface DockerUsage {
	readonly usage: ResourceUsage;
	readonly containers: readonly ResourceItem[];
}

const UNIT_BYTES: Readonly<Record<string, number>> = {
	b: 1,
	kib: 1_024,
	mib: 1_024 ** 2,
	gib: 1_024 ** 3,
	tib: 1_024 ** 4,
	kb: 1_000,
	mb: 1_000 ** 2,
	gb: 1_000 ** 3,
	tb: 1_000 ** 4,
};

export function parseDockerStats(output: string, cores: number): DockerUsage | null {
	let cpuPercent = 0;
	const containers: ResourceItem[] = [];
	for (const line of output.split('\n')) {
		const [label, cpu, memory] = line.split('\t');
		if (!label || !cpu || !memory) continue;
		cpuPercent += (Number.parseFloat(cpu) || 0) / Math.max(1, cores);
		containers.push({
			label,
			workstream: null,
			memoryBytes: parseDockerBytes(memory.split('/')[0] ?? ''),
		});
	}
	if (containers.length === 0) return null;
	return {
		usage: {
			kind: 'docker',
			memoryBytes: containers.reduce((sum, container) => sum + container.memoryBytes, 0),
			cpuPercent,
			processes: containers.length,
		},
		containers,
	};
}

function parseDockerBytes(text: string): number {
	const [, amount, unit] = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/iu.exec(text) ?? [];
	if (!amount || !unit) return 0;
	return Number(amount) * (UNIT_BYTES[unit.toLowerCase()] ?? 0);
}
