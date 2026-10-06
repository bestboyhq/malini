import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	FAILURE_DETAIL_LIMIT,
	IGNORE_SCRIPTS_FLAG,
	InstallRegistry,
	detectInstallPlan,
	failureDetail,
	installDependencies,
	installWithArgv,
	recordCompletion,
	type InstallDeps,
	type InstallPlan,
	type WorkstreamInstallStatusPayload,
} from './provisioning.service';
import { REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL } from '$contract/events';
import { removeAll } from '$main/fs/test-support';
import { ScriptedRunner, sleep, waitFor } from '$main/process/test-support';
import { recordingEventBus } from './test-support';

const dirs: string[] = [];

afterEach(() => removeAll(dirs));

function checkout(files: Array<[string, string]>): string {
	const dir = mkdtempSync(join(tmpdir(), 'malini-provision-'));
	dirs.push(dir);
	for (const [path, contents] of files) {
		const full = join(dir, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, contents);
	}
	return dir;
}

function run(argv: string[]): InstallPlan {
	return { kind: 'run', argv };
}

function planned(dir: string): readonly string[] {
	const plan = detectInstallPlan(dir);
	if (plan.kind !== 'run') throw new Error(`expected a runnable plan, got ${plan.kind}`);
	return plan.argv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isInstallStatusPayload(value: unknown): value is WorkstreamInstallStatusPayload {
	return (
		isRecord(value) &&
		value.type === REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL &&
		typeof value.workstreamId === 'string' &&
		typeof value.status === 'string'
	);
}

function harness(runner = new ScriptedRunner()): {
	deps: InstallDeps;
	events: ReturnType<typeof recordingEventBus>;
	runner: ScriptedRunner;
	statuses: () => string[];
	last: () => WorkstreamInstallStatusPayload;
} {
	const events = recordingEventBus();
	const registry = new InstallRegistry(runner);
	const deps: InstallDeps = { runner, events, registry, env: { PATH: '/nonexistent' } };
	const payloads = (): WorkstreamInstallStatusPayload[] =>
		events.frames
			.filter((frame) => frame.channel === REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL)
			.map((frame) => frame.payload)
			.filter(isInstallStatusPayload);
	return {
		deps,
		events,
		runner,
		statuses: () => payloads().map((payload) => payload.status),
		last: () => {
			const payload = payloads().at(-1);
			if (!payload) throw new Error('no install status emitted');
			return payload;
		},
	};
}

describe('install plan detection', () => {
	it('pins a frozen install for a pnpm lockfile', () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', ''],
		]);
		expect(detectInstallPlan(dir)).toEqual(
			run(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']),
		);
	});

	it('uses npm ci for a package-lock', () => {
		const dir = checkout([
			['package.json', '{}'],
			['package-lock.json', '{}'],
		]);
		expect(detectInstallPlan(dir)).toEqual(run(['npm', 'ci', '--ignore-scripts']));
	});

	it('recognizes yarn and bun lockfiles', () => {
		const yarn = checkout([
			['package.json', '{}'],
			['yarn.lock', ''],
		]);
		expect(detectInstallPlan(yarn)).toEqual(
			run(['yarn', 'install', '--frozen-lockfile', '--ignore-scripts']),
		);
		const bun = checkout([
			['package.json', '{}'],
			['bun.lockb', ''],
		]);
		expect(detectInstallPlan(bun)).toEqual(
			run(['bun', 'install', '--frozen-lockfile', '--ignore-scripts']),
		);
	});

	it('never lets a manager run repository-authored scripts by default', () => {
		const checkouts = [
			checkout([
				['package.json', '{}'],
				['pnpm-lock.yaml', ''],
			]),
			checkout([
				['package.json', '{}'],
				['package-lock.json', '{}'],
			]),
			checkout([
				['package.json', '{}'],
				['yarn.lock', ''],
			]),
			checkout([
				['package.json', '{}'],
				['bun.lock', ''],
			]),
			checkout([
				['package.json', '{}'],
				['bun.lockb', ''],
			]),
			checkout([['package.json', '{"packageManager":"pnpm@11.7.0"}']]),
			checkout([['package.json', '{"packageManager":"npm@10.0.0"}']]),
			checkout([['package.json', '{"packageManager":"yarn@4.0.0"}']]),
			checkout([['package.json', '{"packageManager":"bun@1.2.0"}']]),
		];
		for (const dir of checkouts) {
			const argv = planned(dir);
			expect(argv).toContain(IGNORE_SCRIPTS_FLAG);
			expect(argv.at(-1)).toBe(IGNORE_SCRIPTS_FLAG);
		}
	});

	it('runs scripts only when a human decision asks for them', () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', ''],
		]);
		expect(detectInstallPlan(dir, 'allowedByHuman')).toEqual(
			run(['pnpm', 'install', '--frozen-lockfile']),
		);
	});

	it('lets a lockfile win over a declared package manager', () => {
		const dir = checkout([
			['package.json', '{"packageManager":"yarn@4.0.0"}'],
			['pnpm-lock.yaml', ''],
		]);
		expect(detectInstallPlan(dir)).toEqual(
			run(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']),
		);
	});

	it('falls back to the declared package manager without freezing', () => {
		const dir = checkout([['package.json', '{"packageManager":"pnpm@11.7.0"}']]);
		expect(detectInstallPlan(dir)).toEqual(run(['pnpm', 'install', '--ignore-scripts']));
	});

	it('never runs an unknown package manager', () => {
		for (const manifest of [
			'{"packageManager":"cargo@1.0.0"}',
			'{"packageManager":"; rm -rf /"}',
			'{"packageManager":42}',
			'{ not json',
			'{}',
		]) {
			const dir = checkout([['package.json', manifest]]);
			expect(detectInstallPlan(dir), manifest).toEqual({ kind: 'unrecognized' });
		}
	});

	it('does not treat a checkout without a manifest as a JavaScript project', () => {
		const dir = checkout([['Cargo.toml', '[package]']]);
		expect(detectInstallPlan(dir)).toEqual({ kind: 'no-manifest' });
	});

	it('does not read a half-finished node_modules as installed', () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', 'lockfileVersion: 9'],
			['node_modules/.modules.yaml', ''],
		]);
		expect(detectInstallPlan(dir)).toEqual(
			run(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']),
		);
	});

	it('counts a recorded completion as already installed', () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', 'lockfileVersion: 9'],
			['node_modules/.modules.yaml', ''],
		]);
		recordCompletion(dir, planned(dir));
		expect(detectInstallPlan(dir)).toEqual({ kind: 'already-installed' });
	});

	it('invalidates a recorded completion when the lockfile changes', () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', 'lockfileVersion: 9'],
			['node_modules/.modules.yaml', ''],
		]);
		recordCompletion(dir, planned(dir));
		writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.1');
		expect(detectInstallPlan(dir)).toEqual(
			run(['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']),
		);
	});

	it('keeps the completion marker in the app-managed directory', () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', 'lockfileVersion: 9'],
		]);
		recordCompletion(dir, planned(dir));
		expect(existsSync(join(dir, '.malini/sandbox/install-complete'))).toBe(true);
	});
});

describe('installing', () => {
	it('emits one skip and runs nothing for an unrecognized checkout', async () => {
		const dir = checkout([['package.json', '{}']]);
		const { deps, statuses, last, runner } = harness();
		const outcome = await installDependencies(deps, 'ws-skip', dir);
		expect(outcome).toEqual({ status: 'skipped', reason: 'unrecognized-project' });
		expect(statuses()).toEqual(['skipped']);
		expect(last()).toMatchObject({
			type: REPOSITORIES_WORKSTREAM_INSTALL_STATUS_CHANNEL,
			workstreamId: 'ws-skip',
			reason: 'unrecognized-project',
		});
		expect(runner.spawns).toHaveLength(0);
		expect(existsSync(join(dir, 'node_modules'))).toBe(false);
	});

	it('announces running then succeeded and records the completion', async () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', 'lockfileVersion: 9'],
			['node_modules/.modules.yaml', ''],
		]);
		const runner = new ScriptedRunner().onCommand('pnpm', ['install'], { kind: 'exit', code: 0 });
		const { deps, statuses, last } = harness(runner);
		const outcome = await installDependencies(deps, 'ws-ok', dir);
		expect(outcome).toEqual({ status: 'succeeded' });
		expect(statuses()).toEqual(['running', 'succeeded']);
		expect(last().command).toBe('pnpm install --frozen-lockfile --ignore-scripts');
		expect(typeof last().durationMs).toBe('number');
		expect(runner.last('pnpm').cwd).toBe(dir);
		expect(runner.last('pnpm').args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts']);
		expect(detectInstallPlan(dir)).toEqual({ kind: 'already-installed' });
		expect(runner.groupSignals.at(-1)?.signal).toBe('SIGKILL');
	});

	it('reports the exit code and the stderr tail of a failure', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('sh', [], {
			kind: 'exit',
			code: 7,
			stderr: 'boom\n',
		});
		const { deps, statuses, last } = harness(runner);
		const slot = deps.registry.claim('ws-fail')!;
		const outcome = await installWithArgv(deps, slot, 'ws-fail', dir, ['sh', '-c', 'exit 7']);
		expect(outcome).toEqual({ status: 'failed' });
		expect(statuses()).toEqual(['running', 'failed']);
		expect(last().exitCode).toBe(7);
		expect(last().detail).toBe('boom');
	});

	it('fails rather than throwing when the binary does not exist', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('malini-no-such-package-manager', [], {
			kind: 'spawn-failure',
			error: 'spawn malini-no-such-package-manager ENOENT',
		});
		const { deps, statuses, last } = harness(runner);
		const slot = deps.registry.claim('ws-missing')!;
		const outcome = await installWithArgv(deps, slot, 'ws-missing', dir, [
			'malini-no-such-package-manager',
		]);
		expect(outcome).toEqual({ status: 'failed' });
		expect(statuses()).toEqual(['running', 'failed']);
		expect(last().detail).toContain('ENOENT');
	});

	it('carries a reason printed only on stdout', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('pnpm', [], {
			kind: 'exit',
			code: 1,
			stdout: ' ERR_PNPM_BROKEN_LOCKFILE  nope\n',
		});
		const { deps, last } = harness(runner);
		const slot = deps.registry.claim('ws-pnpm')!;
		const outcome = await installWithArgv(deps, slot, 'ws-pnpm', dir, ['pnpm', 'install']);
		expect(outcome).toEqual({ status: 'failed' });
		expect(last().detail).toBe('ERR_PNPM_BROKEN_LOCKFILE  nope');
	});

	it('reports a timeout as a failure with the cap in the detail', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('pnpm', [], { kind: 'hang' });
		const { deps, last } = harness(runner);
		const slot = deps.registry.claim('ws-slow')!;
		const outcome = await installWithArgv({ ...deps, timeoutMs: 30 }, slot, 'ws-slow', dir, [
			'pnpm',
			'install',
		]);
		expect(outcome).toEqual({ status: 'failed' });
		expect(last().detail).toBe('timed out after 0 minutes');
		expect(runner.groupSignals.some((entry) => entry.signal === 'SIGKILL')).toBe(true);
	});

	it('starts no second install for a busy workstream and says nothing', async () => {
		const dir = checkout([
			['package.json', '{}'],
			['pnpm-lock.yaml', ''],
		]);
		const { deps, statuses, runner } = harness();
		const held = deps.registry.claim('ws-busy')!;
		const outcome = await installDependencies(deps, 'ws-busy', dir);
		expect(outcome).toEqual({ status: 'already-running' });
		expect(statuses()).toEqual([]);
		expect(runner.spawns).toHaveLength(0);
		held.dispose();
		expect(deps.registry.claim('ws-busy')).not.toBeNull();
	});

	it('returns at once when aborting a workstream with no install', async () => {
		const registry = new InstallRegistry(new ScriptedRunner());
		const started = Date.now();
		await registry.abortAndWait('ws-nothing-running');
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it('aborts the whole process group and resolves once it is reaped', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('pnpm', [], { kind: 'manual' });
		const { deps, statuses } = harness(runner);
		const slot = deps.registry.claim('ws-abort')!;
		const installing = installWithArgv(deps, slot, 'ws-abort', dir, ['pnpm', 'install']);
		await waitFor(() => runner.spawns.length === 1);
		expect(deps.registry.has('ws-abort')).toBe(true);
		const pid = runner.last('pnpm').process.pid!;
		const aborting = deps.registry.abortAndWait('ws-abort');
		expect(runner.groupSignals).toEqual([{ pid, signal: 'SIGTERM' }]);
		expect(await installing).toEqual({ status: 'aborted' });
		slot.dispose();
		await aborting;
		expect(deps.registry.has('ws-abort')).toBe(false);
		expect(statuses()).toEqual(['running', 'aborted']);
	});

	it('escalates to SIGKILL when the group ignores SIGTERM', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('pnpm', [], { kind: 'manual' });
		const { deps } = harness(runner);
		const slot = deps.registry.claim('ws-stubborn')!;
		const installing = installWithArgv(deps, slot, 'ws-stubborn', dir, ['pnpm', 'install']);
		await waitFor(() => runner.spawns.length === 1);
		runner.last('pnpm').process.stubborn = true;
		const started = Date.now();
		const aborting = deps.registry.abortAndWait('ws-stubborn');
		const outcome = await installing;
		slot.dispose();
		await aborting;
		expect(outcome).toEqual({ status: 'aborted' });
		expect(runner.groupSignals.map((entry) => entry.signal)).toContain('SIGKILL');
		expect(Date.now() - started).toBeGreaterThanOrEqual(1_900);
	}, 10_000);

	it('kills a child spawned after the abort arrived', async () => {
		const dir = checkout([]);
		const runner = new ScriptedRunner().onCommand('pnpm', [], { kind: 'manual' });
		const { deps, statuses } = harness(runner);
		const slot = deps.registry.claim('ws-race')!;
		void deps.registry.abortAndWait('ws-race');
		await sleep(0);
		const outcome = await installWithArgv(deps, slot, 'ws-race', dir, ['pnpm', 'install']);
		slot.dispose();
		expect(outcome).toEqual({ status: 'aborted' });
		expect(runner.groupSignals[0]?.signal).toBe('SIGKILL');
		expect(statuses()).toEqual(['running', 'aborted']);
	});
});

describe('failure detail', () => {
	it('prefers stderr when both said something', () => {
		expect(failureDetail('chatter', 'the real reason')).toBe('the real reason');
	});

	it('bounds the tail and cuts on a line boundary', () => {
		const long = `${'x'.repeat(FAILURE_DETAIL_LIMIT * 2)}\nthe last line`;
		const detail = failureDetail('', long);
		expect(detail.startsWith('…')).toBe(true);
		expect(detail.endsWith('the last line')).toBe(true);
		expect(Buffer.byteLength(detail)).toBeLessThanOrEqual(FAILURE_DETAIL_LIMIT + 4);
	});

	it('cuts a multibyte tail on a character boundary', () => {
		const long = '✔'.repeat(FAILURE_DETAIL_LIMIT);
		const detail = failureDetail('', long);
		expect(detail.startsWith('…')).toBe(true);
		expect([...detail].slice(1).every((glyph) => glyph === '✔')).toBe(true);
	});
});
