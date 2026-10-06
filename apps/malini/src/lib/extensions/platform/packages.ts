import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { isInsideDirectory } from '$main/fs/paths';
import type {
	ExtensionDevelopmentLog,
	ExtensionSourceSnapshot,
	ManagedExtensionSourceSnapshot,
} from '$contract/system';

export type { ExtensionDevelopmentLog, ExtensionSourceSnapshot, ManagedExtensionSourceSnapshot };

export const NO_MARKETPLACE_ERROR = 'malini has no extension marketplace';

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRYPOINT_BYTES = 16 * 1024 * 1024;

export interface ManagedExtensionInstallRequest {
	id: string;
	version: string;
	manifestJson: string;
	entrypoint: string;
	sha256: string;
	installedAt: string;
	releaseJson: string;
	files: { path: string; contents: number[] }[];
}

export interface ExtensionPackagePaths {
	localRoot: string;
}

export function resolveExtensionPackagePaths(
	roots: { appDataRoot: string },
	env: NodeJS.ProcessEnv = process.env,
): ExtensionPackagePaths {
	const home = env.MALINI_EXTENSION_HOME;
	return {
		localRoot: home ? resolve(home) : join(roots.appDataRoot, 'extensions', 'local'),
	};
}

interface LocalExtensionInstall {
	id: string;
	path: string;
	enabled: boolean;
	watch: boolean;
}

export class ExtensionPackages {
	readonly paths: ExtensionPackagePaths;

	constructor(paths: ExtensionPackagePaths) {
		this.paths = paths;
	}

	listSources(): Promise<ExtensionSourceSnapshot[]> {
		return listLocalSources(this.paths.localRoot);
	}

	listManaged(): Promise<ManagedExtensionSourceSnapshot[]> {
		return Promise.resolve([]);
	}

	installManaged(_request: unknown): Promise<never> {
		return Promise.reject(new Error(NO_MARKETPLACE_ERROR));
	}

	downloadRelease(_url: string): Promise<never> {
		return Promise.reject(new Error(NO_MARKETPLACE_ERROR));
	}

	setManagedEnabled(
		extensionId: string,
		_enabled: boolean,
	): Promise<ManagedExtensionSourceSnapshot> {
		return Promise.reject(new Error(`Managed extension ${extensionId} is not installed`));
	}

	rollbackManaged(extensionId: string): Promise<ManagedExtensionSourceSnapshot> {
		return Promise.reject(new Error(`Managed extension ${extensionId} is not installed`));
	}

	async recoveryModeEnabled(): Promise<boolean> {
		try {
			const value = await readFile(join(this.paths.localRoot, 'recovery-mode'), 'utf8');
			return value.trim() === 'enabled';
		} catch (error) {
			if (isNotFound(error)) return false;
			throw new Error(describeError(error));
		}
	}

	async appendDevelopmentLog(log: ExtensionDevelopmentLog): Promise<void> {
		await mkdir(this.paths.localRoot, { recursive: true });
		const line = JSON.stringify({
			timestamp: log.timestamp,
			level: log.level,
			extensionId: log.extensionId ?? null,
			event: log.event,
			message: log.message,
		});
		await appendFile(join(this.paths.localRoot, 'development.log.ndjson'), `${line}\n`);
	}
}

async function listLocalSources(root: string): Promise<ExtensionSourceSnapshot[]> {
	const registryPath = join(root, 'local.json');
	let contents: string;
	try {
		contents = await readLimited(registryPath, MAX_MANIFEST_BYTES);
	} catch (error) {
		if (isNotFound(error)) return [];
		throw error;
	}
	let installs: LocalExtensionInstall[];
	try {
		installs = parseLocalRegistry(JSON.parse(contents));
	} catch (error) {
		throw new Error(`invalid local extension registry: ${describeError(error)}`);
	}
	const reloads = await readReloadSequences(join(root, 'reload.json'));
	const sources: ExtensionSourceSnapshot[] = [];
	for (const install of installs) {
		const reloadSequence = reloads[install.id] ?? 0;
		try {
			sources.push(await localSnapshot(install, reloadSequence));
		} catch (error) {
			sources.push({
				id: install.id,
				sourceKind: 'local',
				sourcePath: install.path,
				enabled: install.enabled,
				watch: install.watch,
				manifestJson: '',
				entrypointSource: '',
				fingerprint: '',
				reloadSequence,
				loadError: describeError(error),
			});
		}
	}
	return sources;
}

async function localSnapshot(
	install: LocalExtensionInstall,
	reloadSequence: number,
): Promise<ExtensionSourceSnapshot> {
	let sourceRoot: string;
	try {
		sourceRoot = await realpath(install.path);
	} catch (error) {
		throw new Error(`cannot open local extension ${install.path}: ${describeError(error)}`);
	}
	if (!(await stat(sourceRoot)).isDirectory()) {
		throw new Error(`local extension path is not a directory: ${install.path}`);
	}
	const manifestJson = await readLimited(join(sourceRoot, 'manifest.json'), MAX_MANIFEST_BYTES);
	const manifest = parseManifest(manifestJson);
	if (manifest.id !== install.id) {
		throw new Error(`local registry id ${install.id} does not match manifest id ${manifest.id}`);
	}
	const entrypointSource = await readEntrypoint(sourceRoot, manifest.entrypoint);
	return {
		id: install.id,
		sourceKind: 'local',
		sourcePath: sourceRoot,
		enabled: install.enabled,
		watch: install.watch,
		manifestJson,
		entrypointSource,
		fingerprint: fingerprintOf(manifestJson, entrypointSource),
		reloadSequence,
		loadError: null,
	};
}

function parseLocalRegistry(value: unknown): LocalExtensionInstall[] {
	if (!Array.isArray(value)) throw new Error('expected an array of installs');
	return value.map((entry, index) => {
		if (
			!isRecord(entry) ||
			typeof entry.id !== 'string' ||
			typeof entry.path !== 'string' ||
			typeof entry.enabled !== 'boolean' ||
			typeof entry.watch !== 'boolean'
		) {
			throw new Error(`install ${index} is missing id, path, enabled, or watch`);
		}
		return { id: entry.id, path: entry.path, enabled: entry.enabled, watch: entry.watch };
	});
}

async function readReloadSequences(path: string): Promise<Record<string, number>> {
	let contents: string;
	try {
		contents = await readFile(path, 'utf8');
	} catch (error) {
		if (isNotFound(error)) return {};
		throw new Error(describeError(error));
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		throw new Error(describeError(error));
	}
	if (!isRecord(parsed)) throw new Error('reload.json must be an object of id to sequence');
	const reloads: Record<string, number> = {};
	for (const [id, sequence] of Object.entries(parsed)) {
		if (typeof sequence === 'number') reloads[id] = sequence;
	}
	return reloads;
}

interface ManifestIdentity {
	id: string;
	version: string;
	entrypoint: string;
}

function parseManifest(manifestJson: string): ManifestIdentity {
	let manifest: unknown;
	try {
		manifest = JSON.parse(manifestJson);
	} catch (error) {
		throw new Error(`invalid manifest.json: ${describeError(error)}`);
	}
	if (!isRecord(manifest)) throw new Error('invalid manifest.json: not an object');
	if (typeof manifest.id !== 'string') throw new Error('manifest.json is missing id');
	if (typeof manifest.entrypoint !== 'string')
		throw new Error('manifest.json is missing entrypoint');
	return {
		id: manifest.id,
		version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
		entrypoint: manifest.entrypoint,
	};
}

async function readEntrypoint(sourceRoot: string, entrypoint: string): Promise<string> {
	const relativePath = safeLocalRelativePath(entrypoint);
	let entrypointPath: string;
	try {
		entrypointPath = await realpath(join(sourceRoot, relativePath));
	} catch (error) {
		throw new Error(`cannot open extension entrypoint ${entrypoint}: ${describeError(error)}`);
	}
	if (!isInsideDirectory(sourceRoot, entrypointPath)) {
		throw new Error('extension entrypoint escapes its local folder');
	}
	return readLimited(entrypointPath, MAX_ENTRYPOINT_BYTES);
}

function safeLocalRelativePath(value: string): string {
	if (value === '' || isAbsolute(value)) {
		throw new Error('extension entrypoint must stay inside its local folder');
	}
	const normalized = normalize(value);
	if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
		throw new Error('extension entrypoint must stay inside its local folder');
	}
	return normalized;
}

async function readLimited(path: string, maximum: number): Promise<string> {
	const info = await stat(path);
	if (info.size > maximum) {
		throw new Error(`${path} exceeds the ${maximum} byte limit`);
	}
	return readFile(path, 'utf8');
}

function fingerprintOf(manifestJson: string, entrypointSource: string): string {
	const hasher = createHash('sha256');
	hasher.update(manifestJson);
	hasher.update(Buffer.from([0]));
	hasher.update(entrypointSource);
	return hasher.digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
	return isRecord(error) && error.code === 'ENOENT';
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
