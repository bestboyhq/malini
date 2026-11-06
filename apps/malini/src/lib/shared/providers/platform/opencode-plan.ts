import { randomUUID } from 'node:crypto';
import type { ProviderPlan } from '$contract/agent';

export type PlanFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface PlanProbe {
	readonly apiKey: string;
	readonly origin: string;
	readonly fetch: PlanFetch;
}

export const OPENCODE_ORIGIN = 'https://opencode.ai';

const PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_MODELS = 5;
const FALLBACK_GO_MODEL = 'glm-5.3-flash';

export function opencodeProbeOrigin(
	packaged: boolean,
	env: Readonly<Record<string, string | undefined>>,
): string {
	const local = packaged ? undefined : env['MALINI_OPENCODE_PROBE_URL'];
	return local || OPENCODE_ORIGIN;
}

export async function detectOpenCodePlan(probe: PlanProbe): Promise<ProviderPlan | null> {
	for (const model of await probeModels(probe)) {
		const response = await send(probe, `${probe.origin}/inference/go/anthropic/v1/messages`, {
			method: 'POST',
			headers: {
				'anthropic-version': '2023-06-01',
				authorization: `Bearer ${probe.apiKey}`,
				'content-type': 'application/json',
				'x-opencode-session': `malini-${randomUUID()}`,
			},
			body: JSON.stringify({
				model,
				max_tokens: 1,
				messages: [{ role: 'user', content: 'Hi' }],
			}),
		});
		response.body?.cancel().catch(() => undefined);
		if (response.ok) return 'go';
		if (response.status === 401) throw refused();
		if (response.status === 403) return 'console';
		if (response.status === 429) return null;
		if (response.status !== 400) throw cannotCheck();
	}
	throw cannotCheck();
}

async function probeModels(probe: PlanProbe): Promise<string[]> {
	const response = await send(probe, `${probe.origin}/inference/go/v1/models`, {
		headers: { accept: 'application/json', authorization: `Bearer ${probe.apiKey}` },
	});
	if (response.status === 401 || response.status === 403) {
		response.body?.cancel().catch(() => undefined);
		throw refused();
	}
	if (!response.ok) {
		response.body?.cancel().catch(() => undefined);
		throw cannotCheck();
	}
	const body: unknown = await response.json().catch(() => null);
	const listed = modelIds(body).filter((id) => id !== FALLBACK_GO_MODEL);
	return [FALLBACK_GO_MODEL, ...listed].slice(0, MAX_PROBE_MODELS);
}

function modelIds(body: unknown): string[] {
	if (typeof body !== 'object' || body === null || !('data' in body)) return [];
	const { data } = body;
	if (!Array.isArray(data)) return [];
	return data.flatMap((entry) => {
		if (typeof entry !== 'object' || entry === null || !('id' in entry)) return [];
		return typeof entry.id === 'string' && entry.id.length > 0 ? [entry.id] : [];
	});
}

async function send(probe: PlanProbe, url: string, init: RequestInit): Promise<Response> {
	try {
		return await probe.fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
	} catch {
		throw cannotCheck();
	}
}

function refused(): Error {
	return new Error('OpenCode did not accept this key.');
}

function cannotCheck(): Error {
	return new Error('Malini could not check this key with OpenCode. Try again.');
}
