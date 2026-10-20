import { isRecord } from './type-guards.js';

export const DEFAULT_PUBLIC_ERROR_LIMIT = 1_000;
const MAX_ERROR_SCAN_LENGTH = 16_000;

export interface PublicErrorSanitizerOptions {
	readonly maxLength?: number;
}

const ANGLED_PROVIDER_IDENTIFIER_PATTERN = /<(?:org|ak|sk)-[^>\r\n]+>/giu;
const SENSITIVE_PROVIDER_IDENTIFIER_PATTERN =
	/\b(?:org|ak|sk)-[a-z0-9](?:[a-z0-9._~+/=-]*[a-z0-9_~+/=-])?/giu;
const AUTHORIZATION_BEARER_PATTERN =
	/(\bauthorization\b["']?\s*[:=]\s*(?:\[\s*)?["']?\s*bearer\s+)[a-z0-9_~+/=-](?:[a-z0-9._~+/=-]*[a-z0-9_~+/=-])?/giu;
const RAW_PROVIDER_BODY_MARKER = /(?:^|[\r\n]|\s)response[\s_-]*body\s*[:=][\s\S]*$/iu;
const RAW_RESPONSE_JSON_MARKER = /(?:^|[\r\n]|\s)response\s*[:=]\s*["']?[\[{][\s\S]*$/iu;

export function sanitizePublicError(
	error: unknown,
	options: PublicErrorSanitizerOptions = {},
): string {
	const message = errorText(error);
	const structured = structuredErrorMessage(message);
	const publicMessage = structured.detected ? (structured.message ?? '') : message;

	const withoutProviderBody = publicMessage
		.slice(0, MAX_ERROR_SCAN_LENGTH)
		.replace(RAW_PROVIDER_BODY_MARKER, '')
		.replace(RAW_RESPONSE_JSON_MARKER, '')
		.trim();
	const sanitized = withoutProviderBody
		.replace(AUTHORIZATION_BEARER_PATTERN, '$1[redacted]')
		.replace(ANGLED_PROVIDER_IDENTIFIER_PATTERN, '[redacted]')
		.replace(SENSITIVE_PROVIDER_IDENTIFIER_PATTERN, '[redacted]')
		.trim();
	return boundErrorMessage(sanitized || 'Provider request failed.', options.maxLength);
}

function structuredErrorMessage(value: string): { detected: boolean; message?: string } {
	const trimmed = value.trim();
	if (!(
		(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
		(trimmed.startsWith('[') && trimmed.endsWith(']'))
	)) {
		return { detected: false };
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		const message = findStructuredMessage(parsed);
		return { detected: true, ...(message ? { message } : {}) };
	} catch {
		return { detected: false };
	}
}

function findStructuredMessage(value: unknown, depth = 0): string | undefined {
	if (depth > 4) return undefined;
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const message = findStructuredMessage(item, depth + 1);
			if (message) return message;
		}
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	const record = value;
	for (const key of ['error', 'data', 'cause', 'response', 'body']) {
		const message = findStructuredMessage(record[key], depth + 1);
		if (message) return message;
	}
	for (const key of ['message', 'detail', 'error_description']) {
		const message = findStructuredMessage(record[key], depth + 1);
		if (message) return message;
	}
	return undefined;
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	return 'Unexpected error';
}

function boundErrorMessage(message: string, requestedLimit: number | undefined): string {
	const limit = Math.max(1, Math.min(requestedLimit ?? DEFAULT_PUBLIC_ERROR_LIMIT, 4_000));
	if (message.length <= limit) return message;
	if (limit === 1) return '…';
	return `${message.slice(0, limit - 1).trimEnd()}…`;
}
