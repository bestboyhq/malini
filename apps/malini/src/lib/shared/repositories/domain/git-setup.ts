import type { InstallProgressPayload } from '$contract/events';

export type GitSetup =
	| Readonly<{ kind: 'checking' }>
	| Readonly<{ kind: 'ready' }>
	| Readonly<{ kind: 'missing' }>
	| Readonly<{ kind: 'installing'; progress: InstallProgressPayload | null }>
	| Readonly<{ kind: 'failed'; message: string }>;

export function gitHoldsPrompts(setup: GitSetup): boolean {
	return setup.kind !== 'ready' && setup.kind !== 'checking';
}
