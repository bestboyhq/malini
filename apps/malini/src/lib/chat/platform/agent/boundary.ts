import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentBoundary } from '$contract/agent';
import type { AutomationBoundary } from '$contract/automations';
import { BRIDGE_AGENT_ATTACHMENTS_PATH } from '$contract/protocol-contract.generated';
import {
	CHECKOUT_TRASH_DIR_NAME,
	KEPT_WORKSTREAMS_DIR_NAME,
	workstreamsRoot,
} from '$main/git/paths';

const READABLE_APP_DATA = new Set([
	'checkouts',
	'workstreams',
	'repositories',
	'agent',
	'extensions',
]);

export type BoundaryPlaces = Readonly<{
	appDataRoot: string;
	appDataEntries: readonly string[];
	checkoutsRoot: string;
	checkouts: readonly Readonly<{ path: string }>[];
}>;

export function agentBoundary(
	automation: AutomationBoundary,
	places: BoundaryPlaces,
): AgentBoundary | null {
	const chatRecords = automation.chats === 'all';
	if (chatRecords && automation.attachments && automation.internet) return null;
	const { appDataRoot, appDataEntries, checkoutsRoot, checkouts } = places;
	const attachments = automation.attachments
		? []
		: checkouts.map(({ path }) => join(path, BRIDGE_AGENT_ATTACHMENTS_PATH));
	const records = chatRecords
		? []
		: appDataEntries
				.filter((entry) => !READABLE_APP_DATA.has(entry))
				.map((entry) => join(appDataRoot, entry));
	const archived =
		chatRecords && automation.attachments
			? []
			: [
					join(workstreamsRoot(checkoutsRoot), KEPT_WORKSTREAMS_DIR_NAME),
					join(workstreamsRoot(checkoutsRoot), CHECKOUT_TRASH_DIR_NAME),
				];
	return {
		hidden: [...new Set([...attachments, ...records, ...archived])],
		chatRecords,
		internet: automation.internet,
	};
}

export function appDataEntries(appDataRoot: string): string[] {
	try {
		return readdirSync(appDataRoot);
	} catch {
		return [];
	}
}
