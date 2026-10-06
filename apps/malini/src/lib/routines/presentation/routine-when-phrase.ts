import { compileWorkstreamAutomation } from '$shared/extensions/compile-automation-trigger';
import type { RoutineWhenValidation } from '$lib/routines/domain/routine-when-phrase';

export function validateRoutineWhenPhrase(when: string): RoutineWhenValidation {
	if (!when.trim()) {
		return { ok: false, message: 'Choose when the routine should run.' };
	}
	try {
		return { ok: true, description: compileWorkstreamAutomation(when).description };
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}
