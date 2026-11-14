import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const URL_SCHEME = 'malini';

const INSTALLED_DESKTOP_ENTRY = 'malini.desktop';
const LAUNCHER_DESKTOP_ENTRY = 'malini-url-handler.desktop';

type Environment = Readonly<Record<string, string | undefined>>;

export interface LinuxUrlHandler {
	readonly name: string;
	readonly entry: string | null;
}

export function claimsUrlScheme(
	packaged: boolean,
	env: Environment,
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (env['MALINI_BACKGROUND_WINDOW'] === '1') return false;
	return packaged ? platform !== 'darwin' : env['MALINI_DOGFOOD'] === '1';
}

export function urlsIn(argv: readonly string[]): string[] {
	return argv.filter((argument) => argument.toLowerCase().startsWith(`${URL_SCHEME}://`));
}

export function linuxUrlHandler(
	packaged: boolean,
	env: Environment,
	executable: string,
	appPath: string,
): LinuxUrlHandler | null {
	const appImage = env['APPIMAGE'];
	if (!appImage && packaged) return { name: INSTALLED_DESKTOP_ENTRY, entry: null };
	const entry = desktopEntry(appImage ? [appImage] : [executable, appPath]);
	return entry === null ? null : { name: LAUNCHER_DESKTOP_ENTRY, entry };
}

function desktopEntry(launcher: readonly string[]): string | null {
	if (launcher.some((part) => /[\n\r]/u.test(part))) return null;
	return [
		'[Desktop Entry]',
		'Type=Application',
		'Name=Malini',
		'NoDisplay=true',
		`Exec=${[...launcher.map(execArgument), '%u'].join(' ')}`,
		`MimeType=x-scheme-handler/${URL_SCHEME};`,
		'',
	].join('\n');
}

function execArgument(argument: string): string {
	return `"${argument.replace(/[\\"`$]/gu, '\\$&')}"`.replace(/\\/gu, '\\\\').replace(/%/gu, '%%');
}

export async function claimLinuxUrlScheme(
	{ name, entry }: LinuxUrlHandler,
	env: Environment,
): Promise<void> {
	if (entry !== null) {
		const dataHome = env['XDG_DATA_HOME'];
		const applications = join(
			dataHome && isAbsolute(dataHome) ? dataHome : join(homedir(), '.local', 'share'),
			'applications',
		);
		await mkdir(applications, { recursive: true });
		await writeFile(join(applications, name), entry);
	}
	await new Promise<void>((resolve, reject) => {
		execFile('xdg-mime', ['default', name, `x-scheme-handler/${URL_SCHEME}`], (error) =>
			error ? reject(error) : resolve(),
		);
	});
}

export interface UrlInbox {
	receive(url: string): void;
	deliverTo(open: (url: string) => void): void;
}

export function urlInbox(): UrlInbox {
	const waiting: string[] = [];
	let open: ((url: string) => void) | null = null;
	return {
		receive(url) {
			if (open) open(url);
			else waiting.push(url);
		},
		deliverTo(next) {
			open = next;
			for (const url of waiting.splice(0)) next(url);
		},
	};
}
