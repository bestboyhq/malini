export const INVOKE_CHANNEL = 'malini:invoke';
export const EVENT_CHANNEL = 'malini:event';

export interface InvokeRequest {
	command: string;
	args: unknown;
}

export interface CommandFailure {
	name: string;
	message: string;
	code: string | null;
	kind: string | null;
	command: string;
}

export type InvokeReply = { ok: true; value: unknown } | { ok: false; failure: CommandFailure };

export type InvokeResponse = { ok: true; value: unknown } | { ok: false; error: string };

export interface EventFrame {
	channel: string;
	payload: unknown;
}
