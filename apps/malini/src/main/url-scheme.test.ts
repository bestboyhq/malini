import { describe, expect, it } from 'vitest';
import { claimsUrlScheme, linuxUrlHandler, urlInbox, urlsIn } from './url-scheme';

describe('claimsUrlScheme', () => {
	it('claims malini:// only for the dogfood Malini in front of you on a Mac, never for tests or a plain dev run', () => {
		expect(claimsUrlScheme(false, { MALINI_DOGFOOD: '1' }, 'darwin')).toBe(true);
		expect(claimsUrlScheme(false, {}, 'darwin')).toBe(false);
		expect(
			claimsUrlScheme(false, { MALINI_DOGFOOD: '1', MALINI_BACKGROUND_WINDOW: '1' }, 'darwin'),
		).toBe(false);
		expect(claimsUrlScheme(true, { MALINI_DOGFOOD: '1' }, 'darwin')).toBe(false);
	});

	it('claims malini:// at launch for an installed Malini on Windows and Linux, whose installers do not', () => {
		expect(claimsUrlScheme(true, {}, 'win32')).toBe(true);
		expect(claimsUrlScheme(true, {}, 'linux')).toBe(true);
		expect(claimsUrlScheme(true, { MALINI_BACKGROUND_WINDOW: '1' }, 'win32')).toBe(false);
		expect(claimsUrlScheme(false, {}, 'linux')).toBe(false);
		expect(claimsUrlScheme(false, { MALINI_DOGFOOD: '1' }, 'win32')).toBe(true);
	});
});

describe('urlsIn', () => {
	it('finds the malini:// links Windows and Linux pass on the command line, among Chromium switches', () => {
		expect(
			urlsIn([
				'C:\\Program Files\\Malini\\Malini.exe',
				'--allow-file-access-from-files',
				'MALINI://auth?code=1&state=2',
				'malini:auth',
				'https://malini.example',
			]),
		).toEqual(['MALINI://auth?code=1&state=2']);
	});
});

describe('linuxUrlHandler', () => {
	it('points links at the installed malini.desktop of a deb or rpm, and writes its own entry for an AppImage or a dogfood checkout', () => {
		expect(linuxUrlHandler(true, {}, '/opt/Malini/malini', '/opt/Malini/resources/app.asar')).toEqual(
			{ name: 'malini.desktop', entry: null },
		);
		expect(
			linuxUrlHandler(true, { APPIMAGE: '/home/a/Malini.AppImage' }, '/tmp/.mount_x/malini', ''),
		).toEqual({
			name: 'malini-url-handler.desktop',
			entry: [
				'[Desktop Entry]',
				'Type=Application',
				'Name=Malini',
				'NoDisplay=true',
				'Exec="/home/a/Malini.AppImage" %u',
				'MimeType=x-scheme-handler/malini;',
				'',
			].join('\n'),
		});
		expect(
			linuxUrlHandler(false, {}, '/repo/node_modules/electron/dist/electron', '/repo/apps/malini')
				?.entry,
		).toContain('Exec="/repo/node_modules/electron/dist/electron" "/repo/apps/malini" %u\n');
	});

	it('quotes every argument of Exec the way the desktop entry spec reads it back', () => {
		const appImage = '/home/a b/100% "x"/$HOME`id`\\Malini.AppImage';
		expect(linuxUrlHandler(true, { APPIMAGE: appImage }, '', '')?.entry).toContain(
			'\nExec="/home/a b/100%% \\\\"x\\\\"/\\\\$HOME\\\\`id\\\\`\\\\\\\\Malini.AppImage" %u\n',
		);
	});

	it('claims nothing for a launcher it cannot put on one line', () => {
		expect(linuxUrlHandler(true, { APPIMAGE: '/home/a\nExec=evil' }, '', '')).toBeNull();
	});
});

describe('urlInbox', () => {
	it('keeps the links that arrive before Malini is ready and opens them in order once it is', () => {
		const inbox = urlInbox();
		const opened: string[] = [];
		inbox.receive('malini://auth?code=early');
		inbox.receive('malini://auth?code=second');

		inbox.deliverTo((url) => opened.push(url));
		inbox.receive('malini://auth?code=late');

		expect(opened).toEqual([
			'malini://auth?code=early',
			'malini://auth?code=second',
			'malini://auth?code=late',
		]);
	});
});
