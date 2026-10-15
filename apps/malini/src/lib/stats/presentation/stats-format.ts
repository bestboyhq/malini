const GIGABYTE = 1_024 ** 3;
const MEGABYTE = 1_024 ** 2;
const countFormat = new Intl.NumberFormat();

export function formatMemory(bytes: number): string {
	if (bytes >= 10 * GIGABYTE) return `${Math.round(bytes / GIGABYTE)} GB`;
	if (bytes >= 1_000 * MEGABYTE) return `${(bytes / GIGABYTE).toFixed(1)} GB`;
	return `${Math.round(bytes / MEGABYTE)} MB`;
}

export function formatCpu(percent: number): string {
	if (percent > 0 && percent < 1) return '<1%';
	return `${Math.round(percent)}%`;
}

export function formatAgentTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours === 0) return `${minutes}m`;
	if (hours >= 100) return `${hours}h`;
	return `${hours}h ${minutes % 60}m`;
}

export function formatCount(count: number): string {
	return countFormat.format(count);
}

export function plural(count: number, one: string, many: string): string {
	return `${formatCount(count)} ${count === 1 ? one : many}`;
}
