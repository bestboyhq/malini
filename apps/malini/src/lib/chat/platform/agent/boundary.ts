import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentBoundary } from '$contract/agent';
import type { JobBoundary } from '$contract/jobs';
import { LEAD_PLAN_PATH } from '$contract/leads';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '$contract/protocol-contract.generated';

const READABLE_APP_DATA = new Set(['workstreams', 'repositories', 'agent', 'extensions']);

export type BoundaryCheckout = Readonly<{ path: string; lead: boolean }>;

export type BoundaryPlaces = Readonly<{
	appDataRoot: string;
	appDataEntries: readonly string[];
	checkouts: readonly BoundaryCheckout[];
	starterPlan: string | null;
}>;

export function agentBoundary(job: JobBoundary, places: BoundaryPlaces): AgentBoundary | null {
	const chatRecords = job.chats === 'all';
	if (chatRecords && job.attachments && job.internet) return null;
	const { appDataRoot, appDataEntries, checkouts, starterPlan } = places;
	const attachments = job.attachments
		? []
		: checkouts.map(({ path }) => join(path, BRIDGE_AGENT_ATTACHMENTS_PATH));
	const records = chatRecords
		? []
		: [
				...appDataEntries
					.filter((entry) => !READABLE_APP_DATA.has(entry))
					.map((entry) => join(appDataRoot, entry)),
				...checkouts
					.filter(({ lead }) => lead)
					.map(({ path }) => join(path, LEAD_PLAN_PATH))
					.filter((plan) => plan !== starterPlan),
			];
	return {
		hidden: [...new Set([...attachments, ...records])],
		chatRecords,
		internet: job.internet,
	};
}

export function appDataEntries(appDataRoot: string): string[] {
	try {
		return readdirSync(appDataRoot);
	} catch {
		return [];
	}
}
