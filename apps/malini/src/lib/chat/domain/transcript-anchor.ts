export type TranscriptAnchor = Readonly<{ runId: string; row: number; offset: number }>;

export function readTranscriptAnchor(value: unknown): TranscriptAnchor | null {
	if (typeof value !== 'object' || value === null) return null;
	if (!('runId' in value) || !('row' in value) || !('offset' in value)) return null;
	const { runId, row, offset } = value;
	if (typeof runId !== 'string' || runId.length === 0) return null;
	if (typeof row !== 'number' || !Number.isInteger(row) || row < 0) return null;
	if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
	return { runId, row, offset };
}

export function sameTranscriptAnchor(
	left: TranscriptAnchor | null,
	right: TranscriptAnchor | null,
): boolean {
	if (left === null || right === null) return left === right;
	return left.runId === right.runId && left.row === right.row && left.offset === right.offset;
}
