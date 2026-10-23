import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { errnoCode, isRecord } from '../type-guards.js';

const DEFAULT_FILE_MODE = 0o644;

export function claudeUserDirectory(): string {
	return process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
}

export function userSettingsFile(): string {
	return join(claudeUserDirectory(), 'settings.json');
}

export function claudeStateFile(): string {
	const directory = process.env['CLAUDE_CONFIG_DIR'];
	return directory ? join(directory, '.claude.json') : join(homedir(), '.claude.json');
}

export async function allowInUserSettings(rule: string): Promise<void> {
	const file = await realpath(userSettingsFile()).catch(() => userSettingsFile());
	const settings = await readSettings(file);
	const permissions = isRecord(settings['permissions']) ? settings['permissions'] : {};
	const allow: unknown[] = Array.isArray(permissions['allow']) ? permissions['allow'] : [];
	if (allow.includes(rule)) return;
	const allowed = { ...settings, permissions: { ...permissions, allow: [...allow, rule] } };
	await replaceFile(file, `${JSON.stringify(allowed, null, 2)}\n`);
}

async function readSettings(file: string): Promise<Record<string, unknown>> {
	let text: string;
	try {
		text = await readFile(file, 'utf8');
	} catch (error) {
		if (errnoCode(error) === 'ENOENT') return {};
		throw error;
	}
	let settings: unknown;
	try {
		settings = JSON.parse(text);
	} catch {
		throw new Error(`${file} is not valid JSON, so Malini leaves it alone.`);
	}
	if (!isRecord(settings)) throw new Error(`${file} does not hold a JSON object.`);
	return settings;
}

async function existingMode(file: string): Promise<number> {
	try {
		return (await stat(file)).mode & 0o7777;
	} catch (error) {
		if (errnoCode(error) === 'ENOENT') return DEFAULT_FILE_MODE;
		throw error;
	}
}

async function replaceFile(file: string, contents: string): Promise<void> {
	const parent = dirname(file);
	await mkdir(parent, { recursive: true });
	const mode = await existingMode(file);
	const staged = join(parent, `.${randomBytes(8).toString('hex')}.tmp`);
	const handle = await open(staged, 'wx', mode);
	try {
		try {
			await handle.writeFile(contents, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(staged, file);
	} catch (error) {
		await rm(staged, { force: true });
		throw error;
	}
}
