import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShellRun } from '$contract/shell-runs';
import { ShellRuns } from './service';

const WAIT_MS = 10_000;

function startShellRuns(): { shellRuns: ShellRuns; latest: (id: string) => ShellRun | undefined } {
	const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'malini-shell-runs-')));
	const seen = new Map<string, ShellRun>();
	const shellRuns = new ShellRuns({
		checkout: () => checkout,
		environment: () => ({ PATH: process.env['PATH'] ?? '', HOME: checkout, SHELL: '/bin/zsh' }),
		changed: (run) => seen.set(run.id, run),
	});
	cleanups.push(async () => {
		await shellRuns.stopAll();
		rmSync(checkout, { recursive: true, force: true });
	});
	return { shellRuns, latest: (id) => seen.get(id) };
}

async function until<T>(read: () => T | undefined, accept: (value: T) => boolean): Promise<T> {
	const deadline = Date.now() + WAIT_MS;
	for (;;) {
		const value = read();
		if (value !== undefined && accept(value)) return value;
		if (Date.now() > deadline) throw new Error(`timed out, last: ${JSON.stringify(value)}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const workstream = { workstreamId: 'ws-1', sessionId: 'session-1' };

describe('ShellRuns', () => {
	it('runs the command in the checkout and keeps its exit code', async () => {
		const { shellRuns, latest } = startShellRuns();
		const started = await shellRuns.start({ ...workstream, command: 'pwd; echo done; exit 3' });
		expect(started.state).toBe('running');

		const finished = await until(
			() => latest(started.id),
			(run) => run.state !== 'running',
		);
		expect(finished).toMatchObject({ state: 'exited', exitCode: 3 });
		expect(finished.output).toContain('malini-shell-runs-');
		expect(finished.output).toContain('done\n');
	});

	it('gives the command a terminal and passes what the user types', async () => {
		const { shellRuns, latest } = startShellRuns();
		const started = await shellRuns.start({
			...workstream,
			command: 'test -t 0 && printf "name? "; read name; echo "hi $name"',
		});
		await until(
			() => latest(started.id),
			(run) => run.output.includes('name? '),
		);

		shellRuns.write(started.id, 'simon\r');

		const finished = await until(
			() => latest(started.id),
			(run) => run.state !== 'running',
		);
		expect(finished).toMatchObject({ state: 'exited', exitCode: 0 });
		expect(finished.output).toContain('hi simon');
	});

	it('interrupts a command the user stops', async () => {
		const { shellRuns, latest } = startShellRuns();
		const started = await shellRuns.start({ ...workstream, command: 'echo started; sleep 30' });
		await until(
			() => latest(started.id),
			(run) => run.output.includes('started'),
		);

		shellRuns.stop(started.id);

		const stopped = await until(
			() => latest(started.id),
			(run) => run.state !== 'running',
		);
		expect(stopped.state).toBe('stopped');
		expect(() => shellRuns.dismiss(started.id)).not.toThrow();
		expect(shellRuns.list()).toEqual([]);
	});

	it('tells the agent about a finished command once and a running one each time', async () => {
		const { shellRuns, latest } = startShellRuns();
		const finished = await shellRuns.start({ ...workstream, command: 'echo ok' });
		await until(
			() => latest(finished.id),
			(run) => run.state === 'exited',
		);
		const running = await shellRuns.start({ ...workstream, command: 'sleep 30' });

		expect(shellRuns.report(workstream.sessionId)).toEqual([
			{ command: 'echo ok', state: 'exited', exitCode: 0, output: 'ok\n' },
			{ command: 'sleep 30', state: 'running', exitCode: null, output: '' },
		]);
		expect(shellRuns.report(workstream.sessionId).map((run) => run.command)).toEqual(['sleep 30']);
		expect(shellRuns.report('other-session')).toEqual([]);

		expect(() => shellRuns.dismiss(running.id)).toThrow('Stop the command');
		await shellRuns.stopWorkstream(workstream.workstreamId);
		expect(latest(running.id)?.state).toBe('stopped');
	});

	it('refuses an empty command', async () => {
		const { shellRuns } = startShellRuns();
		await expect(shellRuns.start({ ...workstream, command: '  ' })).rejects.toThrow('invalid args');
	});
});
