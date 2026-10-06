import type { ShutdownOutcome, ShutdownUnfinishedContainer } from '$contract/system';
import type { ShutdownImpactLine } from './shutdown-impact';

export interface CloseConfirmation {
	open: boolean;
	checking: boolean;
	impactFailed: boolean;
	idle: boolean;
	closing: boolean;
	destroyFailed: boolean;
	lines: readonly ShutdownImpactLine[];
	unfinishedContainers: readonly ShutdownUnfinishedContainer[];
}

export function closeConfirmationOf(
	open: boolean,
	lines: readonly ShutdownImpactLine[] | null,
	impactFailed: boolean,
	closing: boolean,
	destroyFailed: boolean,
	outcome: ShutdownOutcome | null,
): CloseConfirmation {
	return {
		open,
		checking: lines === null && !impactFailed,
		impactFailed,
		idle: lines !== null && lines.length === 0,
		closing,
		destroyFailed,
		lines: lines ?? [],
		unfinishedContainers: outcome?.containersUnfinished ?? [],
	};
}
