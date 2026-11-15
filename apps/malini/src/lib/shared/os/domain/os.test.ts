import { describe, expect, it } from 'vitest';
import { osFor, osPlatform, osText } from './os';

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
		expect([mac.shortcut('K'), mac.ariaShortcut('K'), mac.backspaceKey]).toEqual([
			'⌘K',
			'Meta+K',
			'⌫',
		]);
	});

	it('writes shortcuts as words joined by plus off the Mac', () => {
		for (const platform of ['win32', 'linux']) {
			const os = osFor(platform);
			expect([
				os.shortcut('K'),
				os.ariaShortcut('Enter'),
				os.primaryReturn,
				os.backspaceKey,
			]).toEqual(['Ctrl+K', 'Control+Enter', 'Ctrl+Enter', 'Backspace']);
		}
	});

	it('fills the OS words into a text and leaves every other brace alone', () => {
		const text =
			"while the {machine} slept, from Malini's {menu} or its {tray} icon, {machine}. {quit}";
		expect(osText(text, osFor('darwin'))).toBe(
			"while the Mac slept, from Malini's menu bar or its menu bar icon, Mac. {quit}",
		);
		expect(osText(text, osFor('win32'))).toBe(
			"while the PC slept, from Malini's menu or its taskbar corner icon, PC. {quit}",
		);
		expect(osText(text, osFor('linux'))).toBe(
			"while the computer slept, from Malini's menu or its tray icon, computer. {quit}",
		);
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
