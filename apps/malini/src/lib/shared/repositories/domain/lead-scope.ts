export type LeadScope = Readonly<{ kind: 'owner'; owner: string }>;

export const LEAD_SPACE_PROJECT_ID = 'malini-lead-space';

export const LEAD_SPACE_BRANCH = 'main';

export const RETIRED_HOME_SCOPE_KEY = 'home';

const OWNER_KEY_PREFIX = 'owner:';

export function leadScopeKey(scope: LeadScope): string {
	return `${OWNER_KEY_PREFIX}${scope.owner}`;
}

export function parseLeadScope(key: string | null | undefined): LeadScope | null {
	if (!key?.startsWith(OWNER_KEY_PREFIX)) return null;
	const owner = key.slice(OWNER_KEY_PREFIX.length).trim();
	return owner.length > 0 ? { kind: 'owner', owner } : null;
}

export function leadScopeOwns(scope: LeadScope, owner: string | null): boolean {
	return owner !== null && scope.owner.toLowerCase() === owner.toLowerCase();
}

export function isRetiredHomeChat(
	chat: Readonly<{ projectId: string; scope: LeadScope | null }>,
): boolean {
	return chat.projectId === LEAD_SPACE_PROJECT_ID && chat.scope === null;
}
