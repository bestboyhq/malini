import { homedir } from 'node:os';

const MAX_ROUTE_CHARS = 1_024;
const MAX_QUERY_ENTRIES = 16;

export function sanitizeRoute(value: string): string {
	const normalized = normalizeText(value, MAX_ROUTE_CHARS * 4, false);
	const withoutFragment = normalized.split('#')[0] ?? '/';
	const scheme = withoutFragment.indexOf('://');
	let pathAndQuery: string;
	if (scheme >= 0) {
		const authority = withoutFragment.slice(scheme + 3);
		const slash = authority.indexOf('/');
		pathAndQuery = slash >= 0 ? authority.slice(slash) : '/';
	} else {
		pathAndQuery = withoutFragment;
	}
	const question = pathAndQuery.indexOf('?');
	const path = question >= 0 ? pathAndQuery.slice(0, question) : pathAndQuery;
	const query = question >= 0 ? pathAndQuery.slice(question + 1) : null;
	const safePath = path.startsWith('/') ? sanitizeRoutePath(path) : '/unparseable-renderer-route';
	if (query === null) return boundChars(safePath, MAX_ROUTE_CHARS);
	const keys = query
		.split('&')
		.slice(0, MAX_QUERY_ENTRIES)
		.map((entry) => sanitizeQueryKey(entry.split('=')[0] ?? 'query'))
		.sort();
	const redactedQuery = keys.map((key) => `${key}=%5Bredacted%5D`).join('&');
	return boundChars(`${safePath}?${redactedQuery}`, MAX_ROUTE_CHARS);
}

function sanitizeRoutePath(path: string): string {
	return path
		.split('/')
		.map((segment) =>
			looksLikeSecretToken(segment) || codePointCount(segment) > 128 ? '%5Bredacted%5D' : segment,
		)
		.join('/');
}

function sanitizeQueryKey(value: string): string {
	const key = [...value]
		.slice(0, 64)
		.map((character) => (/^[A-Za-z0-9_.-]$/.test(character) ? character : '_'))
		.join('');
	return key.length === 0 ? 'query' : key;
}

export function sanitizeDiagnosticText(
	value: string,
	maxChars: number,
	preserveLines: boolean,
	fallback: string,
	home: string = homedir(),
): string {
	const normalized = normalizeText(value, maxChars + REDACTION_SLACK_CHARS, preserveLines);
	const trimmed = redactSensitiveText(normalized, home).trim();
	return trimmed.length === 0 ? fallback : boundChars(trimmed, maxChars);
}

export function redactSensitiveText(input: string, home: string = homedir()): string {
	let value = input;
	if (home.length > 0) value = value.split(home).join('[home]');
	value = redactUserDirectorySegments(value, '/Users/');
	value = redactUserDirectorySegments(value, '/home/');
	value = redactUrlCredentials(value);
	value = redactAuthSchemeTokens(value);
	value = redactAssignments(value);
	return redactTokenShapes(value);
}

const REDACTION_SLACK_CHARS = 1_024;

const CONTROL = /\p{Cc}/u;

function normalizeText(value: string, inputLimit: number, preserveLines: boolean): string {
	let out = '';
	let taken = 0;
	for (const character of value) {
		if (taken >= inputLimit) break;
		taken += 1;
		if (character === '\n' && preserveLines) out += '\n';
		else if (CONTROL.test(character)) out += ' ';
		else out += character;
	}
	return out;
}

const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
	'authorization',
	'password',
	'passwd',
	'secret',
	'token',
	'apikey',
	'cookie',
	'session',
	'oauth_code',
	'oauth-code',
]);

const SENSITIVE_LAST_SEGMENTS: ReadonlySet<string> = new Set([
	'token',
	'secret',
	'password',
	'passwd',
	'apikey',
	'credential',
	'credentials',
]);

const SENSITIVE_KEY_QUALIFIERS: ReadonlySet<string> = new Set([
	'api',
	'access',
	'private',
	'secret',
]);

export function isSensitiveKey(key: string): boolean {
	const lower = asciiLower(key);
	if (SENSITIVE_KEYS.has(lower)) return true;
	const segments = lower.split(/[_.-]/u).filter((segment) => segment.length > 0);
	const last = segments.at(-1);
	if (last === undefined) return false;
	if (SENSITIVE_LAST_SEGMENTS.has(last)) return true;
	const qualifier = segments.at(-2);
	return last === 'key' && qualifier !== undefined && SENSITIVE_KEY_QUALIFIERS.has(qualifier);
}

function redactUserDirectorySegments(value: string, prefix: string): string {
	const out: string[] = [];
	let copied = 0;
	let searchFrom = 0;
	for (;;) {
		const found = value.indexOf(prefix, searchFrom);
		if (found < 0) break;
		const start = found + prefix.length;
		let end = start;
		while (end < value.length && value[end] !== '/' && !isWhitespace(value[end])) end += 1;
		searchFrom = end === start ? start : end;
		if (end === start) continue;
		out.push(value.slice(copied, start), '[user]');
		copied = end;
	}
	out.push(value.slice(copied));
	return out.join('');
}

const AUTHORITY_TERMINATORS: ReadonlySet<string> = new Set(['/', '?', '#', ' ', '\n']);

function redactUrlCredentials(value: string): string {
	const out: string[] = [];
	let copied = 0;
	let searchFrom = 0;
	for (;;) {
		const found = value.indexOf('://', searchFrom);
		if (found < 0) break;
		const authorityStart = found + 3;
		let authorityEnd = authorityStart;
		while (authorityEnd < value.length && !AUTHORITY_TERMINATORS.has(value[authorityEnd] ?? '')) {
			authorityEnd += 1;
		}
		searchFrom = authorityEnd;
		const authority = value.slice(authorityStart, authorityEnd);
		const atOffset = authority.lastIndexOf('@');
		if (atOffset < 0 || !authority.slice(0, atOffset).includes(':')) continue;
		out.push(value.slice(copied, authorityStart), '[redacted]');
		copied = authorityStart + atOffset;
	}
	out.push(value.slice(copied));
	return out.join('');
}

const AUTH_SCHEMES = ['bearer', 'basic'] as const;

function redactAuthSchemeTokens(value: string): string {
	const lower = asciiLower(value);
	const redactions: Array<readonly [number, number]> = [];
	for (const scheme of AUTH_SCHEMES) {
		let searchFrom = 0;
		for (;;) {
			const index = lower.indexOf(scheme, searchFrom);
			if (index < 0) break;
			searchFrom = index + scheme.length;
			if (isIdentifierCharacter(value[index - 1])) continue;
			let cursor = index + scheme.length;
			if (!isAsciiWhitespace(value[cursor])) continue;
			while (isAsciiWhitespace(value[cursor])) cursor += 1;
			const end = consumeUnquotedValue(value, cursor);
			if (end === cursor) continue;
			redactions.push([cursor, end]);
			searchFrom = end;
		}
	}
	return replaceRanges(value, redactions);
}

function redactAssignments(value: string): string {
	const out: string[] = [];
	let copied = 0;
	let index = 0;
	while (index < value.length) {
		const character = value[index];
		if (character !== ':' && character !== '=') {
			index += 1;
			continue;
		}
		const key = keyBefore(value, index);
		const range = key !== null && isSensitiveKey(key) ? assignedValue(value, index + 1) : null;
		if (range === null) {
			index += 1;
			continue;
		}
		out.push(value.slice(copied, range[0]), '[redacted]');
		copied = range[1];
		index = Math.max(range[1], index + 1);
	}
	out.push(value.slice(copied));
	return out.join('');
}

const MAX_KEY_CHARS = 64;

function keyBefore(value: string, separator: number): string | null {
	let end = separator;
	while (end > 0 && isAsciiWhitespace(value[end - 1])) end -= 1;
	if (value[end - 1] === "'" || value[end - 1] === '"') end -= 1;
	let start = end;
	while (start > 0 && end - start < MAX_KEY_CHARS && isIdentifierCharacter(value[start - 1])) {
		start -= 1;
	}
	if (start === end || isIdentifierCharacter(value[start - 1])) return null;
	return value.slice(start, end);
}

function assignedValue(value: string, afterSeparator: number): readonly [number, number] | null {
	let cursor = afterSeparator;
	while (isAsciiWhitespace(value[cursor])) cursor += 1;
	const opener = value[cursor];
	if (opener === undefined) return null;
	if (opener === "'" || opener === '"') {
		const start = cursor + 1;
		const closing = value.indexOf(opener, start);
		const end = closing >= 0 ? closing : consumeUnquotedValue(value, start);
		return start === end ? null : [start, end];
	}
	const end = consumeUnquotedValue(value, cursor);
	return cursor === end ? null : [cursor, end];
}

const VALUE_TERMINATORS: ReadonlySet<string> = new Set([',', ';', '&', '}', ']', "'", '"']);

function consumeUnquotedValue(value: string, start: number): number {
	let end = start;
	while (end < value.length) {
		const character = value[end];
		if (isWhitespace(character) || (character !== undefined && VALUE_TERMINATORS.has(character))) {
			break;
		}
		end += 1;
	}
	return end;
}

function replaceRanges(value: string, ranges: Array<readonly [number, number]>): string {
	if (ranges.length === 0) return value;
	const out: string[] = [];
	let copied = 0;
	for (const [start, end] of [...ranges].sort((left, right) => left[0] - right[0])) {
		if (start < copied) continue;
		out.push(value.slice(copied, start), '[redacted]');
		copied = end;
	}
	out.push(value.slice(copied));
	return out.join('');
}

const TOKEN_CHARACTER = /[A-Za-z0-9_\-.@+%]/u;

function redactTokenShapes(value: string): string {
	const out: string[] = [];
	let copied = 0;
	let tokenStart = -1;
	for (let index = 0; index <= value.length; index += 1) {
		const character = value[index];
		const inToken = character !== undefined && TOKEN_CHARACTER.test(character);
		if (inToken && tokenStart < 0) tokenStart = index;
		if (inToken || tokenStart < 0) continue;
		const token = value.slice(tokenStart, index);
		const redacted = redactedToken(token);
		if (redacted !== token) {
			out.push(value.slice(copied, tokenStart), redacted);
			copied = index;
		}
		tokenStart = -1;
	}
	out.push(value.slice(copied));
	return out.join('');
}

function redactedToken(token: string): string {
	if (looksLikeSecretToken(token)) return '[redacted-token]';
	if (looksLikeEmail(token)) return '[redacted-email]';
	return token;
}

const PROVIDER_KEY_PREFIXES = ['sk-', 'org-', 'ak-'] as const;
const MIN_PROVIDER_KEY_BODY_CHARS = 16;

export function looksLikeSecretToken(value: string): boolean {
	const lower = asciiLower(value);
	const prefix = lower.slice(0, 4);
	return (
		(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'].includes(prefix) && value.length >= 24) ||
		(lower.startsWith('github_pat_') && value.length >= 30) ||
		(value.startsWith('eyJ') && value.split('.').length - 1 >= 2 && value.length >= 24) ||
		PROVIDER_KEY_PREFIXES.some(
			(keyPrefix) =>
				lower.startsWith(keyPrefix) &&
				value.length - keyPrefix.length >= MIN_PROVIDER_KEY_BODY_CHARS,
		)
	);
}

function looksLikeEmail(value: string): boolean {
	const at = value.indexOf('@');
	if (at < 0) return false;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	return local.length > 0 && domain.includes('.') && !domain.endsWith('.');
}

export function boundChars(value: string, maximum: number): string {
	return [...value].slice(0, maximum).join('');
}

function codePointCount(value: string): number {
	let count = 0;
	for (const _ of value) count += 1;
	return count;
}

function asciiLower(value: string): string {
	return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

const IDENTIFIER_CHARACTER = /[A-Za-z0-9_-]/u;

function isIdentifierCharacter(character: string | undefined): boolean {
	return character !== undefined && IDENTIFIER_CHARACTER.test(character);
}

const ASCII_WHITESPACE = /[ \t\n\f\r]/u;

function isAsciiWhitespace(character: string | undefined): boolean {
	return character !== undefined && ASCII_WHITESPACE.test(character);
}

const WHITESPACE = /\s/u;

function isWhitespace(character: string | undefined): boolean {
	return character !== undefined && WHITESPACE.test(character);
}
