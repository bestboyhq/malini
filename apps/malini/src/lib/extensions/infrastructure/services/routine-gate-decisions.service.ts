import { ROUTINES_GATED_RUN_CHANGED_CHANNEL } from '$contract/events';
import { onPlatformEvent } from '$shared/port/events';

import type { WorkstreamExtensionAutomationRuntime } from '../runtime/extension-automation-runtime';

type GatedRunDecisions = Pick<
	WorkstreamExtensionAutomationRuntime,
	'pendingGatedRuns' | 'confirmGatedRun' | 'rejectGatedRun'
>;

export function attachRoutineGateDecisions(
	runtime: GatedRunDecisions,
	onError: (error: Error) => void = (error) => console.error(error),
): () => void {
	return onPlatformEvent(ROUTINES_GATED_RUN_CHANGED_CHANNEL, ({ gatedRun }) => {
		if (gatedRun.state === 'pending') return;
		if (!runtime.pendingGatedRuns.some(({ id }) => id === gatedRun.id)) return;
		const decision =
			gatedRun.state === 'confirmed'
				? runtime.confirmGatedRun(gatedRun.id)
				: runtime.rejectGatedRun(gatedRun.id);
		decision.catch((error: unknown) => {
			onError(error instanceof Error ? error : new Error(String(error)));
		});
	});
}
