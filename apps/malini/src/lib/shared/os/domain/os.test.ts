import { describe, expect, it } from 'vitest';
import { osFor, osPlatform } from './os';

const held = (metaKey: boolean, ctrlKey: boolean) => ({ metaKey, ctrlKey });

describe('the OS words', () => {
	it('narrows any other platform to linux', () => {
		expect(osPlatform('darwin')).toBe('darwin');
		expect(osPlatform('win32')).toBe('win32');
		expect(osPlatform('freebsd')).toBe('linux');
		expect(osFor('linux').platform).toBe('linux');
	});

	it('keeps the Mac words', () => {
		const mac = osFor('darwin');
		expect([mac.reveal, mac.machine, mac.primaryReturn, mac.interrupt]).toEqual([
			'Reveal in Finder',
			'Mac',
			'Command Return',
			'Control-C',
		]);
		expect([mac.shortcut('K'), mac.ariaShortcut('K')]).toEqual(['⌘K', 'Meta+K']);
	});

	it('writes shortcuts as words joined by plus off the Mac', () => {
		for (const platform of ['win32', 'linux']) {
			const os = osFor(platform);
			expect([os.shortcut('K'), os.ariaShortcut('Enter'), os.primaryReturn]).toEqual([
				'Ctrl+K',
				'Control+Enter',
				'Ctrl+Enter',
			]);
		}
	});

	it('holds the primary modifier only without the other one', () => {
		const mac = osFor('darwin');
		const windows = osFor('win32');
		expect([held(true, false), held(false, true), held(true, true)].map(mac.primaryHeld)).toEqual([
			true,
			false,
			false,
		]);
		expect(
			[held(true, false), held(false, true), held(true, true)].map(windows.primaryHeld),
		).toEqual([false, true, false]);
	});
});
