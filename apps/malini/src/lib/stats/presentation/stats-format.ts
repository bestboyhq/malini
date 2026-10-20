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

export function formatElapsed(milliseconds: number): string {
	const seconds = Math.floor(Math.max(0, milliseconds) / 1_000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

export function formatTimeAgo(milliseconds: number): string {
	const minutes = Math.floor(milliseconds / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
	return `${Math.floor(minutes / 1_440)}d ago`;
}
