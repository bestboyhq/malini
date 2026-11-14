import type { RunFailureKind } from '$contract/agent';
import { continuationCause, type ContinuationCause } from '$contract/agent-state-machine';
import { scheduleTime } from '$contract/automation-trigger';

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const DAY_MS = 86_400_000;

const PROVIDER = '{provider}';

const STOP_REASONS: Readonly<Record<RunFailureKind, string>> = {
	'usage-limit': 'You hit your {provider} usage limit. Malini goes on when it resets.',
	'rate-limit': "{provider}'s API is limiting requests. Malini tries again then.",
	overloaded: '{provider} is overloaded. Malini tries again then.',
	'server-error': "{provider}'s API returned an error. Malini tries again then.",
	network: "Malini couldn't reach {provider}'s API. It tries again then.",
	unknown: 'The turn stopped on an unexpected error. Malini tries once more then.',
	'sign-in': 'Claude Code is signed out.',
	billing: 'Your {provider} plan or billing stopped the turn.',
	model: 'The model is not available to your account.',
	request: '{provider} could not take the request.',
};

const CONTINUATION_NOTICES: Readonly<Record<ContinuationCause, readonly [string, ...string[]]>> = {
	restart: [
		'Malini restarted. Back for more',
		'Malini restarted. Now with upgrades',
		'Malini restarted. Feeling brand new',
	],
	outage: ['{provider} is back. Well rested', '{provider} is back. Coffee break over'],
};

const RETRIED = 'Malini stopped trying again.';

const NEXT_STEPS: Readonly<Record<RunFailureKind, string | null>> = {
	'usage-limit': RETRIED,
	'rate-limit': RETRIED,
	overloaded: RETRIED,
	'server-error': RETRIED,
	network: RETRIED,
	unknown: 'Malini tried once more.',
	'sign-in': null,
	billing: 'Check your {provider} plan or billing, then try again.',
	model: 'Pick another model, then try again.',
	request: 'Compact the chat or start a new one, then try again.',
};

export function pauseTitle(resumeAt: string, now: Date): string {
	const at = new Date(resumeAt);
	const time = scheduleTime({ hour: at.getHours(), minute: at.getMinutes() });
	const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
	if (days === 0) return `Paused until ${time}`;
	if (days > 0 && days < 7) return `Paused until ${WEEKDAY_FORMAT.format(at)} ${time}`;
	return `Paused until ${DATE_FORMAT.format(at)}, ${time}`;
}

export function pauseReason(kind: RunFailureKind, provider: string): string {
	return STOP_REASONS[kind].replace(PROVIDER, provider);
}

export function failedRunNextStep(kind: RunFailureKind, provider: string): string | null {
	return NEXT_STEPS[kind]?.replace(PROVIDER, provider) ?? null;
}

export function continuationNotice(prompt: string, roll: number, provider: string): string | null {
	const cause = continuationCause(prompt);
	if (cause === null) return null;
	const notices = CONTINUATION_NOTICES[cause];
	return (notices[roll % notices.length] ?? notices[0]).replace(PROVIDER, provider);
}

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
