import { expect, it } from 'vitest';
import { linuxPasswordStore } from './password-store';

const DESKTOP = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };

it('keeps the last store named on the command line, also over one a preload switched to', () => {
	expect(
		linuxPasswordStore(['malini', '--password-store=basic', '--password-store=kwallet6'], {
			...DESKTOP,
			XDG_CURRENT_DESKTOP: 'GNOME',
			MALINI_BACKGROUND_WINDOW: '1',
		}),
	).toBe('kwallet6');
});

it.each(['GNOME', 'ubuntu:GNOME', 'sway', 'Hyprland', undefined])(
	'seals with the Secret Service on %s with a session bus',
	(desktop) => {
		expect(linuxPasswordStore(['malini'], { ...DESKTOP, XDG_CURRENT_DESKTOP: desktop })).toBe(
			'gnome-libsecret',
		);
	},
);

it('leaves KDE, a session without a bus and a window an agent launched to Chromium', () => {
	expect(linuxPasswordStore(['malini'], { ...DESKTOP, XDG_CURRENT_DESKTOP: 'KDE' })).toBeNull();
	expect(linuxPasswordStore(['malini'], { XDG_CURRENT_DESKTOP: 'GNOME' })).toBeNull();
	expect(linuxPasswordStore(['malini'], { ...DESKTOP, MALINI_BACKGROUND_WINDOW: '1' })).toBeNull();
});
