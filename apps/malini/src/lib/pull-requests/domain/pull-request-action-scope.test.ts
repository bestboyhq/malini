import { describe, expect, it } from 'vitest';
import {
	awaitPullRequestActionScope,
	pullRequestActionScopeIsCurrent,
	type PullRequestActionScope,
	type PullRequestActionScopeSnapshot,
} from './pull-request-action-scope';

type Identity = Readonly<{ id: string }>;

const extensionWorkstream = { id: 'workstream-a' };
const scope: PullRequestActionScope<Identity> = {
	workstreamId: 'workstream-a',
	sessionId: 'chat-a',
	extensionWorkstream,
	extensionGeneration: 4,
	actionRevision: 7,
};

function snapshot(
	overrides: Partial<PullRequestActionScopeSnapshot<Identity>> = {},
): PullRequestActionScopeSnapshot<Identity> {
	return {
		workstreamId: 'workstream-a',
		sessionId: 'chat-a',
		extensionWorkstream,
		extensionGeneration: 4,
		actionRevision: 7,
		ready: true,
		...overrides,
	};
}

describe('pull request action scope', () => {
	it('requires the exact route, extension, generation, and action identity', () => {
		expect(pullRequestActionScopeIsCurrent(scope, snapshot())).toBe(true);
		for (const changed of [
			snapshot({ workstreamId: 'workstream-b' }),
			snapshot({ sessionId: 'chat-b' }),
			snapshot({ extensionWorkstream: { id: 'workstream-a' } }),
			snapshot({ extensionGeneration: 5 }),
			snapshot({ actionRevision: 8 }),
			snapshot({ ready: false }),
		]) {
			expect(pullRequestActionScopeIsCurrent(scope, changed)).toBe(false);
		}
	});

	it('drops a command continuation after A switches to B', async () => {
		const command = deferred<string>();
		let current = snapshot();
		const continuation = awaitPullRequestActionScope(scope, command.promise, () => current);

		current = snapshot({
			workstreamId: 'workstream-b',
			extensionWorkstream: { id: 'workstream-b' },
			extensionGeneration: 5,
			actionRevision: 8,
		});
		command.resolve('workstream-a result');

		await expect(continuation).resolves.toBeNull();
	});

	it('does not revive an A continuation after an A to B to A round trip', async () => {
		const command = deferred<string>();
		let current = snapshot();
		const continuation = awaitPullRequestActionScope(scope, command.promise, () => current);

		current = snapshot({
			extensionWorkstream: { id: 'workstream-a' },
			extensionGeneration: 6,
			actionRevision: 9,
		});
		command.resolve('old workstream-a result');

		await expect(continuation).resolves.toBeNull();
	});

	it('drops a delayed PR refresh before it can target a different chat', async () => {
		const refresh = deferred<string>();
		let current = snapshot();
		const continuation = awaitPullRequestActionScope(scope, refresh.promise, () => current);

		current = snapshot({ sessionId: 'chat-b' });
		refresh.resolve('still failing');

		await expect(continuation).resolves.toBeNull();
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}
