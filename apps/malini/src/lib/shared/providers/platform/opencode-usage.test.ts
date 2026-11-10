import { describe, expect, it } from 'vitest';
import { loadOpencodeUsage, type UsageFetch } from './opencode-usage';

const origin = 'https://opencode.test';
const USAGE_URL = `${origin}/zen/go/v1/usage`;

type Answer = number | { body: string; status?: number } | 'offline';

function probeFetch(answers: Answer[]): {
	fetch: UsageFetch;
	requests: { url: string; init: RequestInit }[];
} {
	const requests: { url: string; init: RequestInit }[] = [];
	let attempt = 0;
	const fetch: UsageFetch = async (url, init) => {
		requests.push({ url, init });
		const answer = answers[Math.min(attempt, answers.length - 1)];
		if (answer === undefined) throw new Error('probe ran dry');
		attempt += 1;
		if (answer === 'offline') throw new Error('offline');
		if (typeof answer === 'number') return new Response('{}', { status: answer });
		return new Response(answer.body, { status: answer.status ?? 200 });
	};
	return { fetch, requests };
}

function probe(answers: Answer[], apiKey = 'oc_sk_test') {
	const { fetch, requests } = probeFetch(answers);
	return {
		request: () => loadOpencodeUsage({ apiKey, origin, fetch }),
		requests,
	};
}

function usageBody(meters: Record<string, unknown>): Answer {
	return { body: JSON.stringify({ usage: meters }) };
}

describe('loadOpencodeUsage', () => {
	it('asks the Go usage endpoint with the key', async () => {
		const { request, requests } = probe([
			usageBody({ rolling: { percent: 20, status: 'ok', resetsAt: '2026-11-09T10:00:00Z' } }),
		]);
		await expect(request()).resolves.toMatchObject({
			limits: [{ label: '5-hour limit', usedPercent: 20 }],
		});
		expect(requests[0]?.url).toBe(USAGE_URL);
		expect(requests[0]?.init.headers).toMatchObject({
			accept: 'application/json',
			authorization: 'Bearer oc_sk_test',
		});
	});

	it('maps the Go windows to labeled limits', async () => {
		const { request } = probe([
			usageBody({
				rolling: { percent: 96.4, status: 'ok', resetsAt: '2026-11-09T10:00:00Z' },
				weekly: { percent: 1, status: 'ok', resetsAt: '2026-11-16T10:00:00Z' },
				monthly: { percent: 8, status: 'ok', resetsAt: '2026-12-09T10:00:00Z' },
			}),
		]);
		await expect(request()).resolves.toMatchObject({
			limits: [
				{ label: '5-hour limit', usedPercent: 96.4, resetsAt: '2026-11-09T10:00:00Z' },
				{ label: 'Weekly limit', usedPercent: 1, resetsAt: '2026-11-16T10:00:00Z' },
				{ label: 'Monthly limit', usedPercent: 8, resetsAt: '2026-12-09T10:00:00Z' },
			],
		});
	});

	it('clamps an out-of-range meter and drops ones that are not valid', async () => {
		const { request } = probe([
			usageBody({
				rolling: { percent: 150, status: 'ok', resetsAt: '2026-11-09T10:00:00Z' },
				weekly: { percent: Number.NaN },
				monthly: { percent: 40, resetsAt: 'not a date' },
			}),
		]);
		await expect(request()).resolves.toMatchObject({
			limits: [
				{ label: '5-hour limit', usedPercent: 100, resetsAt: '2026-11-09T10:00:00Z' },
				{ label: 'Monthly limit', usedPercent: 40, resetsAt: null },
			],
		});
	});

	it('answers null when the endpoint refuses or is not there', async () => {
		await expect(probe([403]).request()).resolves.toBeNull();
		await expect(probe([404]).request()).resolves.toBeNull();
		await expect(probe(['offline']).request()).resolves.toBeNull();
	});

	it('answers null on a body that is not usage', async () => {
		await expect(probe([{ body: 'not json' }]).request()).resolves.toBeNull();
		await expect(probe([{ body: '{"usage":{}}' }]).request()).resolves.toBeNull();
		await expect(probe([{ body: '{"data":[]}' }]).request()).resolves.toBeNull();
	});
});
