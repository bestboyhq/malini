const counts = new Intl.NumberFormat();

export function formatCount(count: number): string {
	return counts.format(count);
}
