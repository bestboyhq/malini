import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, normalize, sep } from 'node:path';

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export interface Spawnable {
	readonly file: string;
	readonly args: string[];
	readonly options: { readonly windowsHide?: true; readonly windowsVerbatimArguments?: true };
}

const WINDOWS = process.platform === 'win32';
const BATCH_FILE = /\.(?:cmd|bat)$/iu;
const SPAWNABLE_EXTENSIONS = new Set(['.COM', '.EXE', '.BAT', '.CMD']);
const CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/gu;

export function spawnable(
	file: string,
	args: readonly string[],
	env: EnvironmentVariables = process.env,
): Spawnable {
	if (!WINDOWS) return { file, args: [...args], options: {} };
	const resolved = findExecutable(file, environmentVariable(env, 'PATH') ?? '') ?? file;
	if (!BATCH_FILE.test(resolved))
		return { file: resolved, args: [...args], options: { windowsHide: true } };
	const line = [escapeCommand(normalize(resolved)), ...args.map(escapeArgument)].join(' ');
	return {
		file: environmentVariable(process.env, 'ComSpec') ?? 'cmd.exe',
		args: ['/d', '/s', '/c', `"${line}"`],
		options: { windowsHide: true, windowsVerbatimArguments: true },
	};
}

export function findExecutable(name: string, path: string): string | null {
	if (name.length === 0) return null;
	if (isAbsolute(name)) return executableNames(name).find(isExecutableFile) ?? null;
	if (name.includes('/') || name.includes(sep)) return null;
	for (const directory of path.split(delimiter)) {
		if (directory.length === 0) continue;
		const found = executableNames(join(directory, name)).find(isExecutableFile);
		if (found) return found;
	}
	return null;
}

export function environmentVariable(env: EnvironmentVariables, name: string): string | undefined {
	if (!WINDOWS) return env[name];
	const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
	return key === undefined ? undefined : env[key];
}

function executableNames(path: string): string[] {
	if (!WINDOWS) return [path];
	if (SPAWNABLE_EXTENSIONS.has(extname(path).toUpperCase())) return [path];
	return (environmentVariable(process.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
		.split(';')
		.map((extension) => extension.toUpperCase())
		.filter((extension) => SPAWNABLE_EXTENSIONS.has(extension))
		.map((extension) => `${path}${extension.toLowerCase()}`);
}

function isExecutableFile(candidate: string): boolean {
	try {
		if (!statSync(candidate, { throwIfNoEntry: false })?.isFile()) return false;
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function escapeCommand(command: string): string {
	return command.replace(CMD_META_CHARACTERS, '^$1');
}

function escapeArgument(argument: string): string {
	const quoted = `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\*)$/u, '$1$1')}"`;
	return quoted.replace(CMD_META_CHARACTERS, '^$1').replace(CMD_META_CHARACTERS, '^$1');
}
