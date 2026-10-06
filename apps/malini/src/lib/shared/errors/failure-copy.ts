export type FailureKind =
	'offline' | 'authorization' | 'rate-limited' | 'timeout' | 'missing' | 'unknown';

export type FailureTone = 'caution' | 'critical';

export interface FailureCopy {
	kind: FailureKind;
	tone: FailureTone;
	heading: string;
	detail: string;
	remedy: string;
	technical: string | null;
}

export interface FailureContext {
	subject: string;
}

const MAX_TECHNICAL_LENGTH = 220;

const OFFLINE_PATTERN =
	/(failed to fetch|network ?error|networkerror|err_internet_disconnected|enotfound|econnrefused|econnreset|ehostunreach|enetunreach|dns|offline|no internet)/i;
const AUTHORIZATION_PATTERN =
	/(\b401\b|\b403\b|unauthori[sz]ed|forbidden|re-?authori[sz]|reauth|authenticat|bad credentials|token (?:has )?expired|permission denied|access denied)/i;
const RATE_LIMIT_PATTERN = /(\b429\b|rate ?limit|abuse detection|too many requests|quota)/i;
const TIMEOUT_PATTERN = /(\b504\b|timed ?out|timeout|deadline exceeded)/i;
const MISSING_PATTERN = /(\b404\b|not found|no such file|enoent|does not exist)/i;

export function sanitizeFailureDetail(raw: string | null | undefined): string {
	if (typeof raw !== 'string') return '';
	const collapsed = raw
		.replace(
			/(?:\/[^\s"':]*)?\/Library\/Application Support\/malini\b[^\s"':]*/g,
			'managed repository storage',
		)
		.replace(/\/Users\/[^\s"':]+/g, 'a local path')
		.replace(/\bworktrees\b/gi, 'workstreams')
		.replace(/\bworktree\b/gi, 'workstream')
		.replace(/\s+/g, ' ')
		.trim();
	if (collapsed.length === 0) return '';
	if (collapsed.length <= MAX_TECHNICAL_LENGTH) return collapsed;
	return `${collapsed.slice(0, MAX_TECHNICAL_LENGTH - 1).trimEnd()}…`;
}

export function classifyFailure(raw: string | null | undefined): FailureKind {
	const message = typeof raw === 'string' ? raw : '';
	if (OFFLINE_PATTERN.test(message)) return 'offline';
	if (AUTHORIZATION_PATTERN.test(message)) return 'authorization';
	if (RATE_LIMIT_PATTERN.test(message)) return 'rate-limited';
	if (TIMEOUT_PATTERN.test(message)) return 'timeout';
	if (MISSING_PATTERN.test(message)) return 'missing';
	return 'unknown';
}

function lowerSubject(subject: string): string {
	const trimmed = subject.trim();
	if (trimmed.length === 0) return 'this data';
	const [first = '', ...rest] = trimmed.split(' ');
	const isProperNoun = /[A-Z]/.test(first.slice(1));
	return isProperNoun ? trimmed : [first.toLowerCase(), ...rest].join(' ');
}

export function describeFailure(
	raw: string | null | undefined,
	context: FailureContext,
): FailureCopy {
	const kind = classifyFailure(raw);
	const technical = sanitizeFailureDetail(raw);
	const subject = context.subject.trim() || 'This data';
	const subjectLower = lowerSubject(subject);

	const copy = (
		tone: FailureTone,
		heading: string,
		detail: string,
		remedy: string,
		includeTechnical = true,
	): FailureCopy => ({
		kind,
		tone,
		heading,
		detail,
		remedy,
		technical: includeTechnical && technical.length > 0 && technical !== detail ? technical : null,
	});

	switch (kind) {
		case 'offline':
			return copy(
				'caution',
				'No network connection',
				`The request for ${subjectLower} never left this device.`,
				'Reconnect to the network, then retry.',
			);
		case 'authorization':
			return copy(
				'caution',
				'Authorization was refused',
				`The stored credentials are no longer accepted for ${subjectLower}.`,
				'Reconnect the account, then retry.',
			);
		case 'rate-limited':
			return copy(
				'caution',
				'Rate limit reached',
				`The upstream API is throttling requests for ${subjectLower}.`,
				'Wait about a minute, then retry.',
			);
		case 'timeout':
			return copy(
				'caution',
				'The request timed out',
				`${subject} did not come back in time.`,
				'Retry. If it keeps timing out, check your connection.',
			);
		case 'missing':
			return copy(
				'caution',
				`${subject} was not found`,
				'It may have been renamed, moved, or removed outside malini.',
				'Refresh to pick up the current state.',
			);
		default:
			return copy(
				'critical',
				`${subject} could not load`,
				technical.length > 0 ? technical : 'malini did not report a reason.',
				'Retry. If this keeps happening, restart malini.',
				false,
			);
	}
}
