export type WorkstreamSnapshotTarget = Readonly<{
	workstreamId: string;
	baseBranch: string;
}>;

export type WorkstreamChangeTotals = Readonly<{
	additions: number;
	deletions: number;
	files: number;
}>;

export type WorkstreamSnapshot = Readonly<{
	patch: string;
	totals: WorkstreamChangeTotals;
}>;

export interface WorkstreamSnapshotReader {
	get(target: WorkstreamSnapshotTarget): Promise<WorkstreamSnapshot>;
	invalidate(target: WorkstreamSnapshotTarget): number;
	invalidateWorkstream(workstreamId: string): void;
	clear(): void;
}
