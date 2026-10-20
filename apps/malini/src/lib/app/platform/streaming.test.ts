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
		expect(streamingAppRunning(QUIET)).toBe(false);
		expect(streamingAppRunning(STREAMING)).toBe(true);
		expect(
			streamingAppRunning('/Applications/Streamlabs Desktop.app/Contents/MacOS/Streamlabs Desktop'),
		).toBe(true);
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
});

function startDetector() {
	const context = createTestContext('/unused');
	const listing = { kind: 'exit' as const, code: 0, stdout: QUIET };
	const probe = { kind: 'exit' as const, code: 0, stdout: 'false\n' };
	const detector = new StreamingDetector(
		context,
		new ScriptedRunner().onCommand('ps', [], listing).onCommand('osascript', [], probe),
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
