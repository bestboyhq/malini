import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubReach } from '$contract/github-failure';
import type { GhResult } from '$main/process/gh';
import { GithubReachWatch } from './github-reach';

const OK: GhResult = { stdout: '{}', stderr: '', code: 0 };
const DOWN: GhResult = { stdout: '', stderr: 'HTTP 503: Service Unavailable\n', code: 1 };
const NO_DNS: GhResult = { stdout: '', stderr: 'error connecting to api.github.com\n', code: 1 };
const NOT_FOUND: GhResult = { stdout: '', stderr: 'HTTP 404: Not Found\n', code: 1 };

function watch(answers: GhResult[], online = (): boolean => true) {
	const changes: GithubReach[] = [];
	const calls: (readonly string[])[] = [];
	const reach = new GithubReachWatch({
		run: async (args) => {
			calls.push(args);
			return answers.shift() ?? OK;
		},
		isOnline: online,
		changed: (next) => changes.push(next),
		probeEveryMs: 1_000,
	});
	return { reach, changes, calls };
}

describe('GithubReachWatch', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('follows what GitHub answers and leaves it as is for answers that say nothing about reach', async () => {
		const { reach, changes } = watch([DOWN, NOT_FOUND, OK]);

		await reach.run(['pr', 'view']);
		expect(reach.reach).toBe('down');
		await reach.run(['pr', 'view']);
		expect(reach.reach).toBe('down');
		await reach.run(['pr', 'view']);

		expect(changes).toEqual(['down', 'ok']);
		reach.dispose();
	});

	it('blames no failure on GitHub while this Mac is offline', async () => {
		const { reach, changes } = watch([NO_DNS], () => false);

		await reach.run(['pr', 'view']);

		expect(reach.reach).toBe('ok');
		expect(changes).toEqual([]);
	});

	it('asks GitHub again while it fails and clears once GitHub answers', async () => {
		vi.useFakeTimers();
		const limited: GhResult = { stdout: '', stderr: 'API rate limit exceeded\n', code: 1 };
		const { reach, changes, calls } = watch([limited, limited, OK]);

		await reach.run(['pr', 'view']);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(reach.reach).toBe('rate-limited');
		await vi.advanceTimersByTimeAsync(1_000);

		expect(reach.reach).toBe('ok');
		expect(changes).toEqual(['rate-limited', 'ok']);
		expect(calls.slice(1).map((args) => args.slice(0, 2))).toEqual([
			['api', 'graphql'],
			['api', 'graphql'],
		]);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(calls).toHaveLength(3);
	});
});
