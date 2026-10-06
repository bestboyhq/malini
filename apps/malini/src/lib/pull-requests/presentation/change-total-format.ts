const COMPACT_UNITS = [
	{ divisor: 1_000_000_000, suffix: 'b' },
	{ divisor: 1_000_000, suffix: 'm' },
	{ divisor: 1_000, suffix: 'k' },
] as const;

export function formatCompactChangeTotal(total: number): string {
	const normalized = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
	const unitIndex = COMPACT_UNITS.findIndex(({ divisor }) => normalized >= divisor);
	const unit = COMPACT_UNITS[unitIndex];
	if (unit === undefined) return String(normalized);

	const compact = roundToOneDecimal(normalized / unit.divisor);
	const finer = compact >= 1_000 ? COMPACT_UNITS[unitIndex - 1] : undefined;
	if (finer === undefined) {
		return `${Number.isInteger(compact) ? compact : compact.toFixed(1)}${unit.suffix}`;
	}

	const finerCompact = roundToOneDecimal(normalized / finer.divisor);
	return `${Number.isInteger(finerCompact) ? finerCompact : finerCompact.toFixed(1)}${finer.suffix}`;
}

function roundToOneDecimal(value: number): number {
	return Math.round(value * 10) / 10;
}
