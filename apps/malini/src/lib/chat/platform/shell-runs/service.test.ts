import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShellRun } from '$contract/shell-runs';
import type { MaliniDatabase } from '$main/db/driver';
import { openChatTestDatabase, seedChatSession, seedChatWorkstream } from '../test-support';
import { ShellRuns } from './service';

const WAIT_MS = 10_000;

function startShellRuns(db = seededDatabase()): {
	shellRuns: ShellRuns;
	db: MaliniDatabase;
	latest: (id: string) => ShellRun | undefined;
} {
	const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'malini-shell-runs-')));
	const seen = new Map<string, ShellRun>();
	const shellRuns = new ShellRuns({
		db,
		checkout: () => checkout,
		environment: () => ({ PATH: process.env['PATH'] ?? '', HOME: checkout, SHELL: '/bin/zsh' }),
		changed: (run) => seen.set(run.id, run),
	});
	cleanups.push(async () => {
		await shellRuns.stopAll();
		rmSync(checkout, { recursive: true, force: true });
	});
	return { shellRuns, db, latest: (id) => seen.get(id) };
}

function seededDatabase(): MaliniDatabase {
	const db = openChatTestDatabase();
	seedChatWorkstream(db, workstream.workstreamId, '/tmp/ws-1');
	seedChatSession(db, workstream.sessionId, workstream.workstreamId);
	return db;
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

let blocks = 0;

function block(): { anchor: { message: string; block: number } } {
	blocks += 1;
	return { anchor: { message: 'message-1', block: blocks } };
}

describe('ShellRuns', () => {
	it('runs the command in the checkout and keeps its exit code', async () => {
		const { shellRuns, latest } = startShellRuns();
		const started = await shellRuns.start({
			...workstream,
			...block(),
			command: 'pwd; echo done; exit 3',
		});
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
			...block(),
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
		const started = await shellRuns.start({
			...workstream,
			...block(),
			command: 'echo started; sleep 30',
		});
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
		const finished = await shellRuns.start({ ...workstream, ...block(), command: 'echo ok' });
		await until(
			() => latest(finished.id),
			(run) => run.state === 'exited',
		);
		const running = await shellRuns.start({ ...workstream, ...block(), command: 'sleep 30' });

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

	it('keeps one run per code block: Run again replaces a finished run, never a running one', async () => {
		const { shellRuns, latest } = startShellRuns();
		const anchor = { message: 'message-2', block: 0 };
		const first = await shellRuns.start({ ...workstream, anchor, command: 'echo first' });
		await until(
			() => latest(first.id),
			(run) => run.state === 'exited',
		);

		const second = await shellRuns.start({ ...workstream, anchor, command: 'sleep 30' });
		expect(second.id).not.toBe(first.id);
		expect(shellRuns.list().map((run) => run.id)).toEqual([second.id]);

		const again = await shellRuns.start({ ...workstream, anchor, command: 'sleep 30' });
		expect(again.id).toBe(second.id);
		expect(shellRuns.list()).toHaveLength(1);
	});

	it('keeps finished runs, and whether the agent read them, across a restart', async () => {
		const { shellRuns, db, latest } = startShellRuns();
		const finish = async (command: string, anchor = block().anchor): Promise<ShellRun> => {
			const started = await shellRuns.start({ ...workstream, anchor, command });
			return until(
				() => latest(started.id),
				(run) => run.state !== 'running',
			);
		};
		const read = await finish('echo read');
		shellRuns.report(workstream.sessionId);
		const unread = await finish('echo unread');
		const cleared = await finish('echo cleared');
		shellRuns.dismiss(cleared.id);
		const rerun = await finish('echo rerun', read.anchor);

		const restarted = startShellRuns(db).shellRuns;

		expect(restarted.list()).toEqual([unread, rerun]);
		expect(restarted.report(workstream.sessionId)).toEqual([
			{ command: 'echo unread', state: 'exited', exitCode: 0, output: 'unread\n' },
			{ command: 'echo rerun', state: 'exited', exitCode: 0, output: 'rerun\n' },
		]);
		expect(startShellRuns(db).shellRuns.report(workstream.sessionId)).toEqual([]);
	});

	it('refuses an empty command', async () => {
		const { shellRuns } = startShellRuns();
		await expect(shellRuns.start({ ...workstream, ...block(), command: '  ' })).rejects.toThrow(
			'invalid args',
		);
	});
});
