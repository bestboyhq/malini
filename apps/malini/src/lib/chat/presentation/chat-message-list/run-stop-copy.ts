import type { RunFailureKind } from '$contract/agent';
import { scheduleTime } from '$contract/automation-trigger';

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const DAY_MS = 86_400_000;

const STOP_REASONS: Readonly<Record<RunFailureKind, string>> = {
	'usage-limit': 'You hit your Claude usage limit. Malini goes on when it resets.',
	'rate-limit': "Claude's API is limiting requests. Malini tries again then.",
	overloaded: 'Claude is overloaded. Malini tries again then.',
	'server-error': "Claude's API returned an error. Malini tries again then.",
	network: "Malini couldn't reach Claude's API. It tries again then.",
	unknown: 'The turn stopped on an unexpected error. Malini tries once more then.',
	'sign-in': 'Claude Code is signed out.',
	billing: 'Your Claude plan or billing stopped the turn.',
	model: 'The model is not available to your account.',
	request: 'Claude could not take the request.',
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
	billing: 'Check your Claude plan or billing, then try again.',
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

export function pauseReason(kind: RunFailureKind): string {
	return STOP_REASONS[kind];
}

export function failedRunNextStep(kind: RunFailureKind): string | null {
	return NEXT_STEPS[kind];
}

function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
