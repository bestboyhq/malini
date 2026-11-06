import { describe, expect, it } from 'vitest';
import { detectOpenCodePlan, opencodeProbeOrigin, type PlanFetch } from './opencode-plan';

const origin = 'https://opencode.test';

type Answer = number | 'offline';

interface ProbeAnswers {
	readonly models?: Answer;
	readonly inference: Answer | readonly Answer[];
	readonly goModels?: readonly string[];
}

interface Recorded {
	readonly url: string;
	readonly init: RequestInit;
}

function probeFetch(answers: ProbeAnswers): { fetch: PlanFetch; requests: Recorded[] } {
	const requests: Recorded[] = [];
	let attempt = 0;
	const fetch: PlanFetch = async (url, init) => {
		requests.push({ url, init });
		if (url.endsWith('/inference/go/v1/models')) {
			const answer = answers.models ?? 200;
			if (answer === 'offline') throw new Error('offline');
			if (answer !== 200) return new Response('{}', { status: answer });
			const data = (answers.goModels ?? ['glm-5.3-flash']).map((id) => ({ id }));
			return new Response(JSON.stringify({ data }), { status: 200 });
		}
		const answersForInference = Array.isArray(answers.inference)
			? answers.inference
			: [answers.inference];
		const answer = answersForInference[Math.min(attempt, answersForInference.length - 1)];
		attempt += 1;
		if (answer === 'offline') throw new Error('offline');
		return new Response('{}', { status: answer ?? 500 });
	};
	return { fetch, requests };
}

function detect(answers: ProbeAnswers) {
	return detectOpenCodePlan({ apiKey: 'oc_sk_test', origin, fetch: probeFetch(answers).fetch });
}

describe('detectOpenCodePlan', () => {
	it('reads a Go key from a message the Go endpoint serves', async () => {
		await expect(detect({ inference: 200 })).resolves.toBe('go');
	});

	it('reads a Console key from the Go endpoint refusing the subscription', async () => {
		await expect(detect({ inference: 403 })).resolves.toBe('console');
	});

	it('leaves the plan unknown when OpenCode rate-limits the check', async () => {
		await expect(detect({ inference: 429 })).resolves.toBeNull();
	});

	it('says the key is refused when either step refuses it', async () => {
		await expect(detect({ models: 401, inference: 200 })).rejects.toThrow(
			'OpenCode did not accept this key.',
		);
		await expect(detect({ inference: 401 })).rejects.toThrow('OpenCode did not accept this key.');
	});

	it('says it could not check when either step does not answer', async () => {
		await expect(detect({ models: 'offline', inference: 200 })).rejects.toThrow(
			'Malini could not check this key with OpenCode. Try again.',
		);
		await expect(detect({ models: 500, inference: 200 })).rejects.toThrow(
			'Malini could not check this key with OpenCode. Try again.',
		);
		await expect(detect({ inference: 'offline' })).rejects.toThrow(
			'Malini could not check this key with OpenCode. Try again.',
		);
		await expect(detect({ inference: 500 })).rejects.toThrow(
			'Malini could not check this key with OpenCode. Try again.',
		);
	});

	it('asks the Go endpoint with a model served in any region and a session id', async () => {
		const probe = probeFetch({ inference: 200, goModels: ['deepseek-v4.1-flash', 'hy4'] });
		await detectOpenCodePlan({ apiKey: 'oc_sk_test', origin, fetch: probe.fetch });
		const post = probe.requests.find((request) => request.init.method === 'POST');
		expect(post?.url).toBe(`${origin}/inference/go/anthropic/v1/messages`);
		expect(post?.init.headers).toMatchObject({
			'anthropic-version': '2023-06-01',
			authorization: 'Bearer oc_sk_test',
			'x-opencode-session': expect.stringMatching(/^malini-/u),
		});
		expect(JSON.parse(String(post?.init.body))).toMatchObject({
			model: 'glm-5.3-flash',
			max_tokens: 1,
		});
	});

	it('skips a model the region excludes and asks the next one', async () => {
		const probe = probeFetch({
			inference: [400, 400, 403],
			goModels: ['deepseek-v4.1-flash', 'glm-5.3-flash', 'hy4'],
		});
		await expect(
			detectOpenCodePlan({ apiKey: 'oc_sk_test', origin, fetch: probe.fetch }),
		).resolves.toBe('console');
		const models = probe.requests
			.filter((request) => request.init.method === 'POST')
			.map((request) => JSON.parse(String(request.init.body)).model);
		expect(models).toEqual(['glm-5.3-flash', 'deepseek-v4.1-flash', 'hy4']);
	});

	it('gives up after five models the region excludes', async () => {
		const probe = probeFetch({
			inference: 400,
			goModels: ['deepseek-v4.1-flash', 'hy4', 'glm-5.2', 'muse-spark-1.2', 'grok-4.7'],
		});
		await expect(
			detectOpenCodePlan({ apiKey: 'oc_sk_test', origin, fetch: probe.fetch }),
		).rejects.toThrow('Malini could not check this key with OpenCode. Try again.');
		expect(probe.requests.filter((request) => request.init.method === 'POST')).toHaveLength(5);
	});

	it('falls back to a Go model when the list names none', async () => {
		const probe = probeFetch({ inference: 200, goModels: [] });
		await detectOpenCodePlan({ apiKey: 'oc_sk_test', origin, fetch: probe.fetch });
		const post = probe.requests.find((request) => request.init.method === 'POST');
		expect(JSON.parse(String(post?.init.body))).toMatchObject({ model: 'glm-5.3-flash' });
	});
});

describe('opencodeProbeOrigin', () => {
	it('uses the local probe only in an unpackaged build', () => {
		expect(opencodeProbeOrigin(false, { MALINI_OPENCODE_PROBE_URL: 'http://localhost:1234' })).toBe(
			'http://localhost:1234',
		);
		expect(opencodeProbeOrigin(true, { MALINI_OPENCODE_PROBE_URL: 'http://localhost:1234' })).toBe(
			'https://opencode.ai',
		);
		expect(opencodeProbeOrigin(false, {})).toBe('https://opencode.ai');
	});
});
