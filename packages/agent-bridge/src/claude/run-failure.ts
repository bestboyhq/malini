import {
	USAGE_LIMIT_ERROR_PREFIXES,
	type SDKAssistantMessageError,
	type SDKMessage,
	type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { isRecord } from '../type-guards.js';
import type { RunFailure, RunFailureKind } from '../types.js';

const ERROR_KINDS: Readonly<Record<SDKAssistantMessageError, RunFailureKind | null>> = {
	authentication_failed: 'sign-in',
	oauth_org_not_allowed: 'sign-in',
	cloud_credential_error: 'sign-in',
	billing_error: 'billing',
	account_on_hold: 'billing',
	verification_required: 'billing',
	rate_limit: 'rate-limit',
	overloaded: 'overloaded',
	model_not_found: 'model',
	invalid_request: 'request',
	max_output_tokens: 'request',
	server_error: null,
	unknown: 'unknown',
};

export const SIGNED_OUT_TEXT = /not logged in|\/login|authentication|invalid api key|oauth/iu;

const STATUS_IN_TEXT = /\bAPI Error: (\d{3})\b/u;

export class RunFailureSignals {
	#error: SDKAssistantMessageError | null = null;
	#usageText = false;
	#resetsAt: number | null = null;
	#retryStatus: number | null = null;

	accept(message: SDKMessage): void {
		if (message.type === 'assistant' && message.parent_tool_use_id === null && message.error) {
			this.#error = message.error;
			this.#usageText ||= isUsageLimitText(assistantText(message.message.content));
			this.#resetsAt = limitResetsAt(Reflect.get(message, 'api_error_params')) ?? this.#resetsAt;
		}
		if (message.type === 'rate_limit_event' && message.rate_limit_info.status === 'rejected') {
			this.#resetsAt = message.rate_limit_info.resetsAt ?? this.#resetsAt;
		}
		if (message.type === 'system' && message.subtype === 'api_retry') {
			this.#retryStatus = message.error_status;
		}
	}

	failure(result: SDKResultMessage): RunFailure {
		const text = resultText(result);
		const status =
			(result.subtype === 'success' ? result.api_error_status : null) ??
			this.#retryStatus ??
			statusInText(text);
		const usage = this.#usageText || isUsageLimitText(text);
		if (this.#resetsAt !== null && (usage || this.#error === 'rate_limit')) {
			return withStatus(
				{ kind: 'usage-limit', resetsAt: new Date(this.#resetsAt * 1000).toISOString() },
				status,
			);
		}
		if (usage) return withStatus({ kind: 'billing' }, status);
		if (result.terminal_reason === 'prompt_too_long') {
			return withStatus({ kind: 'request' }, status);
		}
		const kind =
			(this.#error && ERROR_KINDS[this.#error]) ??
			(this.#error === null && SIGNED_OUT_TEXT.test(text) ? 'sign-in' : null) ??
			statusKind(status, this.#error);
		return withStatus({ kind }, status);
	}
}

export const UNKNOWN_FAILURE: RunFailure = { kind: 'unknown' };

function statusKind(status: number | null, error: SDKAssistantMessageError | null): RunFailureKind {
	if (status === null) return error === 'server_error' ? 'network' : 'unknown';
	if (status === 529) return 'overloaded';
	if (status === 429) return 'rate-limit';
	if (status === 401 || status === 403) return 'sign-in';
	if (status === 402) return 'billing';
	if (status === 404) return 'model';
	if (status === 400 || status === 413) return 'request';
	return 'server-error';
}

function withStatus(failure: RunFailure, status: number | null): RunFailure {
	return status === null ? failure : { ...failure, status };
}

function statusInText(text: string): number | null {
	const status = STATUS_IN_TEXT.exec(text)?.[1];
	return status === undefined ? null : Number(status);
}

function isUsageLimitText(text: string): boolean {
	return USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function assistantText(content: readonly unknown[]): string {
	return content
		.map((block) => (isRecord(block) && typeof block['text'] === 'string' ? block['text'] : ''))
		.join('');
}

function resultText(result: SDKResultMessage): string {
	return result.subtype === 'success' ? result.result : result.errors.join('\n');
}

function limitResetsAt(params: unknown): number | null {
	const info = isRecord(params) ? params['rate_limit_info'] : null;
	const resetsAt = isRecord(info) ? info['resetsAt'] : null;
	return typeof resetsAt === 'number' ? resetsAt : null;
}
