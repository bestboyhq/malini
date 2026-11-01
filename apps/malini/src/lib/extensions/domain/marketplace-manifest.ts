export const MANIFEST_FILE = 'malini.json';
export const README_FILE = 'README.md';
export const LICENSE_FILE = 'LICENSE';
export const SKILL_FILE = 'SKILL.md';

export const MANIFEST_API_VERSION = 2;
export const PACKAGE_MAX_FILES = 500;
export const README_MAX_BYTES = 64 * 1024;

const HANDLE_MAX_LENGTH = 39;
const SLUG_MAX_LENGTH = 64;
const DISPLAY_NAME_MAX_LENGTH = 40;
const DESCRIPTION_MAX_LENGTH = 140;
const REPOSITORY_MAX_LENGTH = 200;
const SERVER_URL_MAX_LENGTH = 300;
const SERVERS_MAX = 10;
const PATH_MAX_LENGTH = 1024;
const SEGMENT_MAX_LENGTH = 255;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const SEGMENT = /^[A-Za-z0-9._@$+=~,-]+$/u;
const CONTROL = /\p{Cc}/u;
const SKILL_PATH = /^skills\/([^/]+)\/(.+)$/u;

const MANIFEST_KEYS = new Set([
	'apiVersion',
	'publisher',
	'name',
	'version',
	'displayName',
	'description',
	'repository',
	'contributes',
]);

export type McpServerEntry = Readonly<{ name: string; url: string }>;

export type MarketplaceManifest = Readonly<{
	publisher: string;
	name: string;
	version: string;
	displayName: string;
	description: string;
	repository: string | null;
	mcpServers: readonly McpServerEntry[];
}>;

export type ManifestProblem = Readonly<{ field: string; error: string }>;

export type ManifestReading =
	| Readonly<{ manifest: MarketplaceManifest; problem: null }>
	| Readonly<{ manifest: null; problem: ManifestProblem }>;

export type PackageEntry = Readonly<{ path: string; size: number }>;

export function readMarketplaceManifest(value: unknown): ManifestReading {
	const problem = manifestProblem(value);
	if (problem || !isRecord(value)) {
		return { manifest: null, problem: problem ?? at('', 'malini.json must be an object.') };
	}
	return { manifest: manifestOf(value), problem: null };
}

export function packageProblem(
	entries: readonly PackageEntry[],
	manifest: MarketplaceManifest,
): ManifestProblem | null {
	if (entries.length > PACKAGE_MAX_FILES) {
		return at('files', `A package holds at most ${PACKAGE_MAX_FILES} files.`);
	}
	const seen = new Set<string>();
	const files = new Set<string>();
	const folders = new Set<string>();
	for (const [index, entry] of entries.entries()) {
		const problem = entryProblem(entry, files, folders);
		if (problem) return at(`files[${index}].path`, problem);
		seen.add(entry.path);
		files.add(entry.path.toLowerCase());
		for (const folder of foldersOf(entry.path.toLowerCase())) folders.add(folder);
	}
	if (!seen.has(MANIFEST_FILE)) return at('files', 'A package needs a malini.json.');
	const skills = skillsIn(entries);
	const empty = skills.find((skill) => !seen.has(`skills/${skill}/${SKILL_FILE}`));
	if (empty) return at('files', `skills/${empty} needs a ${SKILL_FILE}.`);
	if (manifest.mcpServers.length === 0 && skills.length === 0) {
		return at('files', 'An extension needs at least one MCP server or one skill.');
	}
	return null;
}

export function skillsIn(entries: readonly PackageEntry[]): string[] {
	const skills = entries.flatMap(({ path }) => {
		const skill = SKILL_PATH.exec(path)?.[1];
		return skill ? [skill] : [];
	});
	return [...new Set(skills)].sort();
}

export function isNewerVersion(candidate: string, current: string): boolean {
	const next = versionParts(candidate);
	const now = versionParts(current);
	for (const [index, part] of next.entries()) {
		const other = now[index] ?? 0;
		if (part !== other) return part > other;
	}
	return false;
}

export function serverHosts(servers: readonly McpServerEntry[]): string[] {
	return [...new Set(servers.map((server) => new URL(server.url).host))].sort();
}

function manifestProblem(value: unknown): ManifestProblem | null {
	if (!isRecord(value)) return at('', 'malini.json must be an object.');
	const unknown = Object.keys(value).find((key) => !MANIFEST_KEYS.has(key));
	if (unknown) return at(unknown, `${unknown} is not a malini.json field.`);
	if (value.apiVersion !== MANIFEST_API_VERSION) {
		return at('apiVersion', `apiVersion must be ${MANIFEST_API_VERSION}.`);
	}
	return (
		slugProblem(value, 'publisher', HANDLE_MAX_LENGTH) ??
		slugProblem(value, 'name', HANDLE_MAX_LENGTH) ??
		versionProblem(value.version) ??
		textProblem(value, 'displayName', DISPLAY_NAME_MAX_LENGTH) ??
		textProblem(value, 'description', DESCRIPTION_MAX_LENGTH) ??
		repositoryProblem(value.repository) ??
		contributesProblem(value.contributes)
	);
}

function manifestOf(value: Record<string, unknown>): MarketplaceManifest {
	return {
		publisher: String(value.publisher),
		name: String(value.name),
		version: String(value.version),
		displayName: String(value.displayName).trim(),
		description: String(value.description).trim(),
		repository: typeof value.repository === 'string' ? value.repository : null,
		mcpServers: serversOf(value.contributes),
	};
}

function serversOf(contributes: unknown): McpServerEntry[] {
	if (!isRecord(contributes) || !isRecord(contributes.mcpServers)) return [];
	return Object.entries(contributes.mcpServers).flatMap(([name, server]) =>
		isRecord(server) && typeof server.url === 'string' ? [{ name, url: server.url }] : [],
	);
}

function slugProblem(
	value: Record<string, unknown>,
	field: string,
	maxLength: number,
): ManifestProblem | null {
	const slug = value[field];
	if (typeof slug === 'string' && slug.length <= maxLength && SLUG.test(slug)) return null;
	return at(
		field,
		`${field} is 1 to ${maxLength} lowercase letters, digits and single hyphens between them.`,
	);
}

function versionProblem(version: unknown): ManifestProblem | null {
	if (typeof version === 'string' && VERSION.test(version)) {
		if (versionParts(version).every(Number.isSafeInteger)) return null;
	}
	return at('version', 'version is MAJOR.MINOR.PATCH, such as 1.0.0.');
}

function textProblem(
	value: Record<string, unknown>,
	field: string,
	maxLength: number,
): ManifestProblem | null {
	const text = value[field];
	if (typeof text !== 'string' || !within(text.trim(), 1, maxLength)) {
		return at(field, `${field} is 1 to ${maxLength} characters.`);
	}
	if (CONTROL.test(text)) return at(field, `${field} cannot hold control characters.`);
	return null;
}

function repositoryProblem(repository: unknown): ManifestProblem | null {
	if (repository === undefined || repository === null) return null;
	if (isHttpsUrl(repository, REPOSITORY_MAX_LENGTH)) return null;
	return at(
		'repository',
		`repository is an https:// URL of at most ${REPOSITORY_MAX_LENGTH} characters.`,
	);
}

function contributesProblem(contributes: unknown): ManifestProblem | null {
	if (contributes === undefined || contributes === null) return null;
	if (!isRecord(contributes)) return at('contributes', 'contributes must be an object.');
	const unknown = Object.keys(contributes).find((key) => key !== 'mcpServers');
	if (unknown)
		return at(`contributes.${unknown}`, `${unknown} is not something an extension adds.`);
	return serversProblem(contributes.mcpServers);
}

function serversProblem(servers: unknown): ManifestProblem | null {
	if (servers === undefined || servers === null) return null;
	const field = 'contributes.mcpServers';
	if (!isRecord(servers)) return at(field, 'mcpServers must be an object of named servers.');
	const entries = Object.entries(servers);
	if (entries.length > SERVERS_MAX)
		return at(field, `An extension adds at most ${SERVERS_MAX} MCP servers.`);
	for (const [name, server] of entries) {
		const problem = serverProblem(name, server);
		if (problem) return at(`${field}.${name}${problem.field}`, problem.error);
	}
	return null;
}

function serverProblem(name: string, server: unknown): ManifestProblem | null {
	if (name.length > SLUG_MAX_LENGTH || !SLUG.test(name)) {
		return at('', `${name} is not a server name: lowercase letters, digits and single hyphens.`);
	}
	if (!isRecord(server)) return at('', 'A server is { "url": "https://…" }.');
	const unknown = Object.keys(server).find((key) => key !== 'url');
	if (unknown)
		return at(`.${unknown}`, 'Malini lists remote MCP servers only, as { "url": "https://…" }.');
	if (isHttpsUrl(server.url, SERVER_URL_MAX_LENGTH)) return null;
	return at('.url', `url is an https:// URL of at most ${SERVER_URL_MAX_LENGTH} characters.`);
}

function entryProblem(
	entry: PackageEntry,
	files: ReadonlySet<string>,
	folders: ReadonlySet<string>,
): string | null {
	const segments = entry.path.split('/');
	if (
		entry.path.length > PATH_MAX_LENGTH ||
		segments.some(
			(segment) =>
				!SEGMENT.test(segment) ||
				segment === '.' ||
				segment === '..' ||
				segment.length > SEGMENT_MAX_LENGTH,
		)
	) {
		return `${entry.path} is not a plain relative path of at most ${PATH_MAX_LENGTH} characters.`;
	}
	const lower = entry.path.toLowerCase();
	if (files.has(lower)) return `${entry.path} is in the package twice.`;
	if (folders.has(lower) || foldersOf(lower).some((folder) => files.has(folder))) {
		return `${entry.path} is both a file and a folder in the package.`;
	}
	if (entry.path === README_FILE && entry.size > README_MAX_BYTES) {
		return `${README_FILE} is at most ${README_MAX_BYTES / 1024} KB.`;
	}
	if (entry.path === MANIFEST_FILE || entry.path === README_FILE || entry.path === LICENSE_FILE) {
		return null;
	}
	const skill = SKILL_PATH.exec(entry.path)?.[1];
	if (skill && skill.length <= SLUG_MAX_LENGTH && SLUG.test(skill)) return null;
	return `${entry.path} is not malini.json, ${README_FILE}, ${LICENSE_FILE} or a file in skills/<skill>/.`;
}

function foldersOf(path: string): string[] {
	const segments = path.split('/');
	return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

function within(text: string, min: number, max: number): boolean {
	const length = [...text].length;
	return length >= min && length <= max;
}

function versionParts(version: string): number[] {
	return version.split('.').map(Number);
}

function isHttpsUrl(value: unknown, maxLength: number): value is string {
	if (typeof value !== 'string' || !within(value, 1, maxLength) || !URL.canParse(value)) {
		return false;
	}
	const url = new URL(value);
	return url.protocol === 'https:' && url.username === '' && url.password === '';
}

function at(field: string, error: string): ManifestProblem {
	return { field, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
