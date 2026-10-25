import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SOUND_MAX_BYTES } from '$contract/sounds';
import type { MainContext } from '$main/context';
import { openMigratedDatabase } from '$main/db/open';
import { createEventBus } from '$main/events';
import { CommandRegistry } from '$main/ipc/registry';
import { registerSounds } from './register';

const RECORDING = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

let context: MainContext;
let microphoneAsks: number;
let picked: string | null;
let folder: string;

beforeEach(() => {
	microphoneAsks = 0;
	picked = null;
	folder = mkdtempSync(join(tmpdir(), 'malini-sounds-'));
	context = {
		db: openMigratedDatabase(':memory:'),
		commands: new CommandRegistry(),
		events: createEventBus({ forwardToWindows: false }),
		appDataRoot: '/tmp/malini',
		resourcesRoot: '/tmp/malini',
		isDev: false,
		appVersion: '0.0.0',
	};
	registerSounds(context, {
		askForMicrophone: async () => {
			microphoneAsks += 1;
			return false;
		},
		openMicrophoneSettings: async () => undefined,
		pickSoundFile: async () => picked,
	});
});

afterEach(() => {
	context.db.close();
	rmSync(folder, { recursive: true, force: true });
});

describe('your own sounds', () => {
	it('keeps a recording and a file, in the order you added them, with their bytes', async () => {
		expect(await context.commands.call('sounds.list', undefined)).toEqual([]);

		const recording = await context.commands.call('sounds.add', {
			label: '  Recording 1 ',
			kind: 'recording',
			mediaType: 'audio/webm;codecs=opus',
			bytes: RECORDING,
		});
		const file = await context.commands.call('sounds.add', {
			label: 'Doorbell',
			kind: 'file',
			mediaType: 'audio/mpeg',
			bytes: new Uint8Array([0xff, 0xfb]),
		});

		expect(await context.commands.call('sounds.list', undefined)).toEqual([
			{ id: recording.id, label: 'Recording 1', kind: 'recording', createdAt: recording.createdAt },
			{ id: file.id, label: 'Doorbell', kind: 'file', createdAt: file.createdAt },
		]);
		const read = await context.commands.call('sounds.read', { id: recording.id });
		expect(read.mediaType).toBe('audio/webm;codecs=opus');
		expect([...read.bytes]).toEqual([...RECORDING]);
	});

	it('refuses a sound that is not audio, empty, unnamed or too large, and an unknown id', async () => {
		const add = (args: Record<string, unknown>): Promise<unknown> =>
			context.commands.invoke({
				command: 'sounds.add',
				args: { label: 'Bell', kind: 'file', mediaType: 'audio/wav', bytes: RECORDING, ...args },
			});

		for (const [args, message] of [
			[{ mediaType: 'image/png' }, /mediaType/u],
			[{ mediaType: 'audio/wav"><script>' }, /mediaType/u],
			[{ kind: 'stolen' }, /kind/u],
			[{ label: ' ' }, /label/u],
			[{ bytes: new Uint8Array() }, /bytes/u],
			[{ bytes: 'AAAA' }, /bytes/u],
			[{ bytes: new Uint8Array(SOUND_MAX_BYTES + 1) }, /at most 5 MB/u],
		] as const) {
			await expect(add(args)).resolves.toMatchObject({
				ok: false,
				error: expect.stringMatching(message),
			});
		}
		expect(await context.commands.call('sounds.list', undefined)).toEqual([]);
		await expect(
			context.commands.invoke({ command: 'sounds.read', args: { id: 'custom-gone' } }),
		).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/no sound/u) });
	});

	it('removes the one sound you remove, and keeps the rest', async () => {
		const add = (label: string): Promise<{ id: string }> =>
			context.commands.call('sounds.add', {
				label,
				kind: 'recording',
				mediaType: 'audio/webm',
				bytes: RECORDING,
			});
		const first = await add('Recording 1');
		const second = await add('Recording 2');

		await context.commands.call('sounds.remove', { id: first.id });

		expect(
			(await context.commands.call('sounds.list', undefined)).map((sound) => sound.id),
		).toEqual([second.id]);
		await expect(
			context.commands.invoke({ command: 'sounds.read', args: { id: first.id } }),
		).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/no sound/u) });
		await expect(
			context.commands.invoke({ command: 'sounds.remove', args: { id: 7 } }),
		).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/`id`/u) });
	});

	it('asks the system for the microphone each time a recording starts', async () => {
		expect(await context.commands.call('sounds.ask-microphone', undefined)).toBe(false);
		expect(await context.commands.call('sounds.ask-microphone', undefined)).toBe(false);
		expect(microphoneAsks).toBe(2);
	});

	it('reads the sound file you pick, and nothing when you cancel', async () => {
		expect(await context.commands.call('sounds.pick-file', undefined)).toBeNull();

		picked = join(folder, 'Door Bell.MP3');
		writeFileSync(picked, new Uint8Array([0xff, 0xfb, 0x90]));
		const sound = await context.commands.call('sounds.pick-file', undefined);
		expect(sound?.name).toBe('Door Bell.MP3');
		expect(sound?.mediaType).toBe('audio/mpeg');
		expect([...(sound?.bytes ?? [])]).toEqual([0xff, 0xfb, 0x90]);
	});

	it('refuses a picked file that is not a sound or is too large', async () => {
		const pick = (): Promise<unknown> =>
			context.commands.invoke({ command: 'sounds.pick-file', args: undefined });

		picked = join(folder, 'notes.txt');
		writeFileSync(picked, 'hello');
		await expect(pick()).resolves.toMatchObject({
			ok: false,
			error: expect.stringMatching(/not a sound file/u),
		});

		picked = join(folder, 'long.wav');
		writeFileSync(picked, '');
		truncateSync(picked, SOUND_MAX_BYTES + 1);
		await expect(pick()).resolves.toMatchObject({
			ok: false,
			error: expect.stringMatching(/at most 5 MB/u),
		});
	});
});
