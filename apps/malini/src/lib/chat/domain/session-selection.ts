export type SessionSelectionRequest = Readonly<{
	generation: number;
	workstreamId: string;
	userChoices: number;
}>;

export const SESSION_SELECTION_SUPERSEDED = Symbol('session-selection-superseded');

export type SupersededSessionSelection = typeof SESSION_SELECTION_SUPERSEDED;
