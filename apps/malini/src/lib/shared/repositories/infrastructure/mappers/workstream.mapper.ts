import type {
	Workstream,
	WorkstreamCheckoutState,
	WorkstreamStatus,
} from '$shared/repositories/domain/workstream';

const WORKSTREAM_STATUSES: ReadonlySet<string> = new Set([
	'active',
	'paused',
	'merged',
	'archived',
]);

const WORKSTREAM_CHECKOUT_STATES: ReadonlySet<string> = new Set([
	'healthy',
	'path-diverged',
	'missing',
	'not-a-checkout',
	'unresolvable',
]);

type RawWorkstream = {
	id: string;
	projectId: string;
	name: string;
	path: string;
	branch: string;
	baseBranch: string;
	status: string;
	checkoutState?: string;
	checkoutIssue?: string | null;
	resolvedPath?: string | null;
};

export class WorkstreamMapper {
	static fromRawList(raws: unknown): Workstream[] {
		if (!Array.isArray(raws)) return [];
		return raws.filter(isRawWorkstream).map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawWorkstream): Workstream {
		return {
			id: raw.id,
			projectId: raw.projectId,
			name: raw.name,
			path: raw.path,
			branch: raw.branch,
			baseBranch: raw.baseBranch,
			status: toStatus(raw.status),
			checkoutState: toCheckoutState(raw.checkoutState),
			checkoutIssue: raw.checkoutIssue ?? null,
			resolvedPath: raw.resolvedPath ?? null,
		};
	}
}

function toStatus(value: string): WorkstreamStatus {
	return isWorkstreamStatus(value) ? value : 'active';
}

function isWorkstreamStatus(value: string): value is WorkstreamStatus {
	return WORKSTREAM_STATUSES.has(value);
}

function toCheckoutState(value: string | undefined): WorkstreamCheckoutState {
	if (value === undefined) return 'unobserved';
	return WORKSTREAM_CHECKOUT_STATES.has(value) ? toKnownCheckoutState(value) : 'unresolvable';
}

function toKnownCheckoutState(value: string): WorkstreamCheckoutState {
	return isWorkstreamCheckoutState(value) ? value : 'unresolvable';
}

function isWorkstreamCheckoutState(value: string): value is WorkstreamCheckoutState {
	return WORKSTREAM_CHECKOUT_STATES.has(value);
}

function isRawWorkstream(value: unknown): value is RawWorkstream {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		typeof value.projectId === 'string' &&
		typeof value.name === 'string' &&
		typeof value.path === 'string' &&
		typeof value.branch === 'string' &&
		typeof value.baseBranch === 'string' &&
		typeof value.status === 'string' &&
		(value.checkoutState === undefined || typeof value.checkoutState === 'string') &&
		(value.checkoutIssue === undefined ||
			value.checkoutIssue === null ||
			typeof value.checkoutIssue === 'string') &&
		(value.resolvedPath === undefined ||
			value.resolvedPath === null ||
			typeof value.resolvedPath === 'string')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
