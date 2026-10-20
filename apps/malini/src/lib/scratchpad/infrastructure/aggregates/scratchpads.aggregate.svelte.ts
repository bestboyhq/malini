import { scratchpadKey, type ScratchpadState } from '$lib/scratchpad/domain/scratchpad';

class ScratchpadsAggregate {
	pads = $state.raw<Readonly<Record<string, ScratchpadState>>>({});

	stateOf(repositoryFullName: string): ScratchpadState | null {
		return this.pads[scratchpadKey(repositoryFullName)] ?? null;
	}

	set(repositoryFullName: string, state: ScratchpadState): void {
		this.pads = { ...this.pads, [scratchpadKey(repositoryFullName)]: state };
	}
}

export const scratchpadsAggregate = new ScratchpadsAggregate();
