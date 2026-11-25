import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isEventChannel } from '$contract/events';
import {
	PLAN_WIDGET_ID,
	WIDGET_METHODS,
	WIDGET_SCOPES,
	WIDGETS_FOLDER,
	type WidgetDefinition,
	type WidgetMethod,
	type WidgetOrigin,
	type WidgetRefresh,
	type WidgetScope,
	type WidgetSource,
} from '$contract/widgets';
import { canonicalJson, isRecord } from '$main/db/rows';
import {
	describeError,
	errorCode,
	MaliniError,
	SHARED_ERROR_VERDICTS,
	type ErrorVerdicts,
} from '$main/errors';

const WIDGET_ERROR_VERDICTS = {
	...SHARED_ERROR_VERDICTS,
	'not-found': 'expected',
	'bad-widget': 'expected',
	'source-failed': 'expected',
	'workstream-gone': 'expected',
	'shared-widget': 'expected',
} as const satisfies ErrorVerdicts;

type WidgetErrorKind = keyof typeof WIDGET_ERROR_VERDICTS;

export class WidgetError extends MaliniError<WidgetErrorKind> {
	constructor(kind: WidgetErrorKind, message: string) {
		super('WidgetError', WIDGET_ERROR_VERDICTS, kind, message);
	}
}

export const REFRESH_DEFAULT_SECONDS = 300;
const REFRESH_MIN_SECONDS = 15;
const REFRESH_MAX_SECONDS = 86_400;
const WIDGET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const WIDGET_ID_MAX_LENGTH = 64;
const DERIVED_ID_MAX_LENGTH = 48;
const TITLE_MAX_LENGTH = 80;
const SOURCE_MAX_LENGTH = 2_000;
const BODY_MAX_LENGTH = 16 * 1024;
const HEADERS_MAX = 20;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/u;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FILE_MAX_BYTES = 64 * 1024;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const LINE_BREAK = /[\n\r\u2028\u2029]/u;

export const PLAN_WIDGET: WidgetDefinition = {
	id: PLAN_WIDGET_ID,
	title: 'Plan',
	icon: 'checklist',
	scope: 'shared',
	source: { kind: 'plan' },
	refresh: { everySeconds: REFRESH_DEFAULT_SECONDS, on: [] },
	url: null,
	author: null,
	fingerprint: fingerprintOf({ kind: 'plan' }),
	origin: 'plan',
};

export function isWidgetId(value: unknown): value is string {
	return typeof value === 'string' && value.length <= WIDGET_ID_MAX_LENGTH && WIDGET_ID.test(value);
}

export function isGithubLogin(value: unknown): value is string {
	return typeof value === 'string' && GITHUB_LOGIN.test(value);
}

export function widgetPath(id: string): string {
	return `${WIDGETS_FOLDER}/${id}.json`;
}

export function fingerprintOf(source: WidgetSource): string {
	return createHash('sha256').update(canonicalJson(source)).digest('hex');
}

export function parseWidgetFile(
	id: string,
	value: unknown,
	origin: Exclude<WidgetOrigin, 'plan'>,
): WidgetDefinition {
	if (!isWidgetId(id)) {
		throw bad(`the id \`${id}\` must be kebab-case: lowercase letters, digits and single dashes`);
	}
	if (id === PLAN_WIDGET_ID) throw bad('the id `plan` belongs to the built-in Plan widget');
	if (!isRecord(value)) throw bad('a widget file holds one JSON object');
	const source = widgetSource(value['source']);
	return {
		id,
		title: title(value['title']),
		icon: optional(value['icon'], iconName),
		scope: optional(value['scope'], scope) ?? 'shared',
		source,
		refresh: refresh(value['refresh']),
		url: optional(value['url'], webUrl),
		author: optional(value['author'], author),
		fingerprint: fingerprintOf(source),
		origin,
	};
}

export async function readWidgetFiles(
	home: string,
	origin: Exclude<WidgetOrigin, 'plan'>,
	skip: (path: string, problem: string) => void,
): Promise<WidgetDefinition[]> {
	let names: string[];
	try {
		const entries = await readdir(join(home, WIDGETS_FOLDER), { withFileTypes: true });
		names = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
			.map((entry) => entry.name);
	} catch (error) {
		if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
		throw error;
	}
	const widgets = await Promise.all(
		names.map(async (name) => {
			const id = name.slice(0, -'.json'.length);
			try {
				return [await readWidgetFile(home, id, origin)];
			} catch (error) {
				skip(widgetPath(id), describeError(error));
				return [];
			}
		}),
	);
	return widgets.flat().sort((left, right) => left.id.localeCompare(right.id));
}

export async function readWidgetFile(
	home: string,
	id: string,
	origin: Exclude<WidgetOrigin, 'plan'>,
): Promise<WidgetDefinition> {
	return parseWidgetFile(id, await readJson(home, widgetPath(id)), origin);
}

export function freeWidgetId(taken: ReadonlySet<string>, title: unknown): string {
	const base =
		(typeof title === 'string' ? title : '')
			.normalize('NFKD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, '-')
			.slice(0, DERIVED_ID_MAX_LENGTH)
			.replace(/^-+|-+$/gu, '') || 'widget';
	for (let n = 1; ; n += 1) {
		const id = n === 1 ? base : `${base}-${n}`;
		if (id !== PLAN_WIDGET_ID && !taken.has(id)) return id;
	}
}

export async function writeWidgetFile(home: string, widget: WidgetDefinition): Promise<void> {
	const target = join(home, widgetPath(widget.id));
	const staged = `${target}.${process.pid}.tmp`;
	await mkdir(join(home, WIDGETS_FOLDER), { recursive: true });
	await writeFile(staged, widgetFileText(widget));
	await rename(staged, target);
}

function widgetFileText(widget: WidgetDefinition): string {
	const { source } = widget;
	const file = {
		title: widget.title,
		...(widget.icon === null ? {} : { icon: widget.icon }),
		scope: widget.scope,
		source: sourceFile(source),
		refresh: { every: widget.refresh.everySeconds, on: widget.refresh.on },
		...(widget.url === null ? {} : { url: widget.url }),
		...(widget.author === null ? {} : { author: widget.author }),
	};
	return `${JSON.stringify(file, null, '\t')}\n`;
}

function sourceFile(source: WidgetSource): Readonly<Record<string, unknown>> {
	if (source.kind === 'github') return { github: source.path, ...selectFile(source.select) };
	if (source.kind !== 'http') return {};
	const { url, method, headers, body, keyUrl } = source;
	return {
		http: {
			url,
			method,
			...(Object.keys(headers).length === 0 ? {} : { headers }),
			...(body === null ? {} : { body }),
			...(keyUrl === null ? {} : { keyUrl }),
		},
		...selectFile(source.select),
	};
}

function selectFile(select: string | null): Readonly<Record<string, string>> {
	return select === null ? {} : { select };
}

async function readJson(home: string, path: string): Promise<unknown> {
	const file = join(home, path);
	if ((await stat(file)).size > FILE_MAX_BYTES) throw bad('the file is larger than 64 KB');
	const text = await readFile(file, 'utf8');
	try {
		const parsed: unknown = JSON.parse(text);
		return parsed;
	} catch (error) {
		throw bad(`the file is not JSON: ${describeError(error)}`);
	}
}

function widgetSource(value: unknown): WidgetSource {
	if (!isRecord(value)) throw bad('`source` must be an object with `http` or `github`');
	const { github, http, mcp, command, select } = value;
	if ([github, http, mcp, command].filter((each) => each !== undefined).length > 1) {
		throw bad('`source` names one of `http` or `github`');
	}
	if (http !== undefined) return { ...httpRequest(http), select: optional(select, jq) };
	if (github !== undefined) {
		return { kind: 'github', path: githubPath(github), select: optional(select, jq) };
	}
	const retired = retiredLine(mcp, command);
	if (retired !== null) return { kind: 'retired', line: retired };
	throw bad('`source` must name an `http` request or a `github` API path');
}

function retiredLine(mcp: unknown, command: unknown): string | null {
	if (typeof command === 'string' && command.trim() !== '') return oneLine(`Runs ${command}`);
	if (isRecord(mcp) && typeof mcp['server'] === 'string' && typeof mcp['tool'] === 'string') {
		return oneLine(`${mcp['server']} · ${mcp['tool']}`);
	}
	return null;
}

function oneLine(text: string): string {
	return text.replace(/\s+/gu, ' ').trim().slice(0, SOURCE_MAX_LENGTH);
}

function httpRequest(value: unknown): Omit<Extract<WidgetSource, { kind: 'http' }>, 'select'> {
	if (!isRecord(value)) throw bad('`source.http` must be an object with a `url`');
	const method = optional(value['method'], httpMethod) ?? 'GET';
	const body = optional(value['body'], requestBody);
	if (body !== null && method === 'GET') throw bad('`source.http.body` needs `"method": "POST"`');
	return {
		kind: 'http',
		url: apiUrl(value['url']),
		method,
		headers: optional(value['headers'], requestHeaders) ?? {},
		body,
		keyUrl: optional(value['keyUrl'], webUrl),
	};
}

function apiUrl(value: unknown): string {
	const url =
		typeof value === 'string' && value.length <= SOURCE_MAX_LENGTH ? URL.parse(value) : null;
	const reachable =
		url?.protocol === 'https:' || (url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
	if (url === null || !reachable || url.username !== '' || url.password !== '') {
		throw bad('`source.http.url` must be an https address, or http on localhost');
	}
	return url.href;
}

function httpMethod(value: unknown): WidgetMethod {
	const upper = typeof value === 'string' ? value.toUpperCase() : value;
	const known = WIDGET_METHODS.find((method) => method === upper);
	if (known === undefined) throw bad('`source.http.method` must be `GET` or `POST`');
	return known;
}

function requestHeaders(value: unknown): Readonly<Record<string, string>> {
	if (!isRecord(value) || Object.keys(value).length > HEADERS_MAX) {
		throw bad(`\`source.http.headers\` must map up to ${HEADERS_MAX} header names to text`);
	}
	return Object.fromEntries(
		Object.entries(value).map(([name, text]) => {
			if (
				!HEADER_NAME.test(name) ||
				typeof text !== 'string' ||
				text.length > SOURCE_MAX_LENGTH ||
				LINE_BREAK.test(text)
			) {
				throw bad('`source.http.headers` must map header names to one line of text each');
			}
			return [name, text];
		}),
	);
}

function requestBody(value: unknown): Readonly<Record<string, unknown>> {
	if (!isRecord(value) || JSON.stringify(value).length > BODY_MAX_LENGTH) {
		throw bad('`source.http.body` must be a JSON object under 16 KB');
	}
	return value;
}

function githubPath(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value === '' ||
		value.length > SOURCE_MAX_LENGTH ||
		value.startsWith('-') ||
		value.startsWith('//') ||
		value.includes('://') ||
		value.includes('..') ||
		/\s/u.test(value)
	) {
		throw bad(
			'`source.github` must be a GitHub API path such as `repos/{owner}/{repo}/actions/runs`, with no spaces, no `..` and no leading `-`',
		);
	}
	return value;
}

function jq(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > SOURCE_MAX_LENGTH) {
		throw bad('`source.select` must be a jq expression');
	}
	return value.trim();
}

function title(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (trimmed.length === 0 || trimmed.length > TITLE_MAX_LENGTH || LINE_BREAK.test(trimmed)) {
		throw bad(`\`title\` must be one line of 1 to ${TITLE_MAX_LENGTH} characters`);
	}
	return trimmed;
}

function iconName(value: unknown): string {
	if (!isWidgetId(value)) throw bad('`icon` must be the kebab-case name of an icon');
	return value;
}

function scope(value: unknown): WidgetScope {
	const known = WIDGET_SCOPES.find((candidate) => candidate === value);
	if (known === undefined) throw bad('`scope` must be `shared` or `own`');
	return known;
}

function webUrl(value: unknown): string {
	const url =
		typeof value === 'string' && value.length <= SOURCE_MAX_LENGTH ? URL.parse(value) : null;
	if (url?.protocol !== 'https:' && url?.protocol !== 'http:') {
		throw bad('`url` must be an http or https address');
	}
	return url.href;
}

function author(value: unknown): string {
	if (!isGithubLogin(value)) throw bad('`author` must be a GitHub login');
	return value;
}

function refresh(value: unknown): WidgetRefresh {
	if (value === undefined || value === null) {
		return { everySeconds: REFRESH_DEFAULT_SECONDS, on: [] };
	}
	if (!isRecord(value)) throw bad('`refresh` must be an object with `every` and `on`');
	const every = optional(value['every'], seconds) ?? REFRESH_DEFAULT_SECONDS;
	const on = optional(value['on'], channels) ?? [];
	return {
		everySeconds: Math.min(REFRESH_MAX_SECONDS, Math.max(REFRESH_MIN_SECONDS, Math.round(every))),
		on: [...new Set(on.filter((channel) => isEventChannel(channel) && !isWidgetChannel(channel)))],
	};
}

export function isWidgetChannel(channel: string): boolean {
	return channel.startsWith('widgets:');
}

function seconds(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw bad('`refresh.every` must be a number of seconds');
	}
	return value;
}

function channels(value: unknown): string[] {
	if (!Array.isArray(value)) throw bad('`refresh.on` must be a list of event channels');
	return value.map((channel: unknown) => {
		if (typeof channel !== 'string') throw bad('`refresh.on` must be a list of event channels');
		return channel;
	});
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | null {
	return value === undefined || value === null ? null : parse(value);
}

function bad(message: string): WidgetError {
	return new WidgetError('bad-widget', message);
}
