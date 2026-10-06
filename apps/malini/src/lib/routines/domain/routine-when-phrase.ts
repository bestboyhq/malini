export const ROUTINE_WHEN_PHRASES = [
	'when a new workstream is created',
	'when a frontend resource becomes ready',
	'when a frontend Docker container becomes ready',
] as const;

export type RoutineWhenPhrase = (typeof ROUTINE_WHEN_PHRASES)[number];

export type RoutineWhenValidation =
	Readonly<{ ok: true; description: string }> | Readonly<{ ok: false; message: string }>;
