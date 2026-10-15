import type { ResourceUsage } from '$contract/stats';

export const DOCKER_STATS_FORMAT = '{{.CPUPerc}}\t{{.MemUsage}}';

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

export function parseDockerStats(output: string, cores: number): ResourceUsage | null {
	let memoryBytes = 0;
	let cpuPercent = 0;
	let containers = 0;
	for (const line of output.split('\n')) {
		const [cpu, memory] = line.split('\t');
		if (!cpu || !memory) continue;
		containers += 1;
		cpuPercent += (Number.parseFloat(cpu) || 0) / Math.max(1, cores);
		memoryBytes += parseDockerBytes(memory.split('/')[0] ?? '');
	}
	if (containers === 0) return null;
	return { kind: 'docker', memoryBytes, cpuPercent, processes: containers };
}

function parseDockerBytes(text: string): number {
	const [, amount, unit] = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/iu.exec(text) ?? [];
	if (!amount || !unit) return 0;
	return Number(amount) * (UNIT_BYTES[unit.toLowerCase()] ?? 0);
}
