type Environment = Readonly<Record<string, string | undefined>>;

const ASKED = /^--password-store=(.+)$/u;

export function linuxPasswordStore(argv: readonly string[], env: Environment): string | null {
	const asked = argv.flatMap((argument) => ASKED.exec(argument)?.[1] ?? []).at(-1);
	if (asked) return asked;
	if (env['MALINI_BACKGROUND_WINDOW'] === '1' || !env['DBUS_SESSION_BUS_ADDRESS']) return null;
	return /KDE/iu.test(env['XDG_CURRENT_DESKTOP'] ?? '') ? null : 'gnome-libsecret';
}
