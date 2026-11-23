import { describe, expect, it } from 'vitest';
import { APP_STREAMING_CHANGED_CHANNEL } from '$contract/events';
import { ScriptedRunner } from '$main/process/test-support';
import { StreamingDetector, streamingAppRunning } from './streaming';
import { createTestContext } from './test-support';

const QUIET = [
	'/sbin/launchd',
	'/Applications/Obsidian.app/Contents/MacOS/Obsidian',
	'/Applications/Notes OBS.app/Contents/MacOS/Notes OBS',
	'/Users/ada/Downloads/OBS.app.zip',
].join('\n');

const STREAMING = `${QUIET}\n/Applications/OBS.app/Contents/MacOS/OBS\n`;

describe('streaming detection', () => {
	it('recognizes a running streaming app by its bundle, not by a similar name', () => {
		expect(streamingAppRunning(QUIET, 'darwin')).toBe(false);
		expect(streamingAppRunning(STREAMING, 'darwin')).toBe(true);
		expect(
			streamingAppRunning(
				'/Applications/Streamlabs Desktop.app/Contents/MacOS/Streamlabs Desktop',
				'darwin',
			),
		).toBe(true);
	});

	it('recognizes a running streaming app by its program on Linux and Windows', () => {
		expect(streamingAppRunning('systemd\nobsidian\nnotes-obs\n', 'linux')).toBe(false);
		expect(streamingAppRunning('systemd\nobs\n', 'linux')).toBe(true);
		expect(streamingAppRunning(tasks('explorer.exe', 'Obsidian.exe'), 'win32')).toBe(false);
		expect(streamingAppRunning(tasks('explorer.exe', 'obs64.exe'), 'win32')).toBe(true);
		expect(streamingAppRunning(tasks('Streamlabs OBS.exe'), 'win32')).toBe(true);
		expect(streamingAppRunning(tasks('vMix64.exe'), 'win32')).toBe(true);
	});

	it('looks only for the apps it is given', () => {
		expect(streamingAppRunning(STREAMING, 'darwin', ['e2e4242'])).toBe(false);
		expect(
			streamingAppRunning(`${QUIET}\n/tmp/e2e-a/e2e4242.app/Contents/MacOS/sleep`, 'darwin', [
				'e2e4242',
			]),
		).toBe(true);
	});

	it('lists Windows programs with tasklist and probes no screen', async () => {
		const context = createTestContext('/unused');
		const runner = new ScriptedRunner().onCommand('tasklist.exe', ['/fo', 'csv', '/nh'], {
			kind: 'exit',
			code: 0,
			stdout: tasks('explorer.exe', 'obs64.exe'),
		});
		const detector = new StreamingDetector(context, runner, 'win32');
		await detector.check();
		expect(runner.spawns.map(({ file }) => file)).toEqual([
			expect.stringMatching(/\\System32\\tasklist\.exe$/u),
		]);
		const reply = await context.commands.invoke({ command: 'app.streaming', args: undefined });
		expect(reply).toEqual({ ok: true, value: true });
		context.db.close();
	});

	it('reports a change once when a streaming app starts and once when it quits', async () => {
		const { context, detector, listing, changes, streaming } = startDetector();

		await detector.check();
		expect(await streaming()).toBe(false);

		listing.stdout = STREAMING;
		await detector.check();
		await detector.check();
		expect(await streaming()).toBe(true);

		listing.stdout = QUIET;
		await detector.check();
		expect(changes).toEqual([true, false]);
		context.db.close();
	});

	it('reports streaming while an app records the screen, even across a failed probe', async () => {
		const { context, detector, probe, changes, streaming } = startDetector();

		await detector.check();
		probe.stdout = 'true\n';
		await detector.check();
		expect(await streaming()).toBe(true);

		probe.code = 1;
		await detector.check();
		expect(await streaming()).toBe(true);

		probe.code = 0;
		probe.stdout = 'false\n';
		await detector.check();
		expect(changes).toEqual([true, false]);
		context.db.close();
	});

	it('ignores screen recording on this Mac while it looks only for the apps it is given', async () => {
		process.env['MALINI_STREAMING_APPS'] = 'e2e4242';
		try {
			const { context, detector, probe, streaming } = startDetector();
			probe.stdout = 'true\n';
			await detector.check();
			expect(await streaming()).toBe(false);
			context.db.close();
		} finally {
			delete process.env['MALINI_STREAMING_APPS'];
		}
	});
});

function tasks(...images: string[]): string {
	return images
		.map((image, index) => `"${image}","${index + 4}","Console","1","10,240 K"`)
		.join('\r\n');
}

function startDetector() {
	const context = createTestContext('/unused');
	const listing = { kind: 'exit' as const, code: 0, stdout: QUIET };
	const probe = { kind: 'exit' as const, code: 0, stdout: 'false\n' };
	const detector = new StreamingDetector(
		context,
		new ScriptedRunner().onCommand('ps', [], listing).onCommand('osascript', [], probe),
		'darwin',
	);
	const changes: boolean[] = [];
	context.events.subscribe(APP_STREAMING_CHANGED_CHANNEL, ({ streaming }) => {
		changes.push(streaming);
	});
	const streaming = async (): Promise<unknown> => {
		const reply = await context.commands.invoke({ command: 'app.streaming', args: undefined });
		return reply.ok ? reply.value : reply;
	};
	return { context, detector, listing, probe, changes, streaming };
}
