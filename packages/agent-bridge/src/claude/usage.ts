import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeContextUsage, ClaudeQuery } from './session.js';

const SNAPSHOT_TIMEOUT_MS = 2_000;

type PlanRateLimits = NonNullable<SDKControlGetUsageResponse['rate_limits']>;
type PlanWindow = { readonly utilization: number | null; readonly resets_at: string | null };

const PLAN_WINDOWS: readonly (readonly [keyof PlanRateLimits, string])[] = [
	['five_hour', '5-hour limit'],
	['seven_day', 'Weekly limit'],
	['seven_day_opus', 'Weekly Opus limit'],
	['seven_day_sonnet', 'Weekly Sonnet limit'],
];

export async function anthropicMetrics(
	query: ClaudeQuery,
	observedAt: Date,
): Promise<{ readonly anthropic: Record<string, unknown> } | null> {
	const [context, usage, init] = await Promise.all([
		settleWithin(query.getContextUsage({ detail: 'summary' })),
		settleWithin(
			query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
		),
		settleWithin(query.initializationResult()),
	]);
	const anthropic = {
		...(context ? { contextCategories: contextCategories(context) } : {}),
		...(usage?.rate_limits
			? {
					rateLimits: planRateLimits(usage.rate_limits),
					observedAt: observedAt.toISOString(),
					account: init?.account.email ?? null,
				}
			: {}),
	};
	return Object.keys(anthropic).length > 0 ? { anthropic } : null;
}

function contextCategories(usage: ClaudeContextUsage) {
	return usage.categories
		.filter((category) => category.tokens > 0)
		.map(({ name, tokens, kind }) => ({ name, tokens, kind }));
}

function planRateLimits(limits: PlanRateLimits) {
	const windows: (readonly [string, PlanWindow | null | undefined])[] = [
		...PLAN_WINDOWS.map(([key, label]) => [label, windowOf(limits[key])] as const),
		...(limits.model_scoped ?? []).map(
			(model) => [`Weekly ${model.display_name} limit`, model] as const,
		),
	];
	return windows.flatMap(([label, window]) =>
		window ? [{ label, utilization: window.utilization, resetsAt: window.resets_at }] : [],
	);
}

function windowOf(value: PlanRateLimits[keyof PlanRateLimits]): PlanWindow | null {
	return value && !Array.isArray(value) && 'resets_at' in value ? value : null;
}

async function settleWithin<T>(operation: Promise<T>): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS);
	});
	try {
		return await Promise.race([operation.catch(() => null), timeout]);
	} finally {
		clearTimeout(timer);
	}
}
