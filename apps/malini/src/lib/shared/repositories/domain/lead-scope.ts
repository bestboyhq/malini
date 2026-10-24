export type LeadScope = Readonly<{ kind: 'home' }> | Readonly<{ kind: 'owner'; owner: string }>;

export const HOME_SCOPE: LeadScope = { kind: 'home' };

export const LEAD_SPACE_PROJECT_ID = 'malini-lead-space';

export const LEAD_SPACE_BRANCH = 'main';

const OWNER_KEY_PREFIX = 'owner:';

export function leadScopeKey(scope: LeadScope): string {
	return scope.kind === 'home' ? 'home' : `${OWNER_KEY_PREFIX}${scope.owner}`;
}

export function parseLeadScope(key: string | null | undefined): LeadScope | null {
	if (key === 'home') return HOME_SCOPE;
	if (!key?.startsWith(OWNER_KEY_PREFIX)) return null;
	const owner = key.slice(OWNER_KEY_PREFIX.length).trim();
	return owner.length > 0 ? { kind: 'owner', owner } : null;
}

export function leadScopeLabel(scope: LeadScope): string {
	return scope.kind === 'home' ? 'Home' : scope.owner;
}

export function leadScopeOwns(scope: LeadScope, owner: string | null): boolean {
	return (
		scope.kind === 'home' || (owner !== null && scope.owner.toLowerCase() === owner.toLowerCase())
	);
}
