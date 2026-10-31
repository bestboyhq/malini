import type { StatsMoment } from '$contract/stats';
import type { IconName } from '$hyper-ui/icons';
import { formatCount } from './stats-format';

export type MomentBadge = Readonly<{ icon: IconName; tone: string; cheer: string; fact: string }>;

const STREAK_BADGES: ReadonlyMap<number, MomentBadge> = new Map([
	[
		7,
		{
			icon: 'flame',
			tone: 'text-accent-2-primary',
			cheer: '7 days straight',
			fact: 'agents skipped lunch',
		},
	],
	[
		30,
		{
			icon: 'bolt',
			tone: 'text-warning-content',
			cheer: '30 days straight',
			fact: 'agents want PTO',
		},
	],
	[
		100,
		{
			icon: 'crown',
			tone: 'text-warning-content',
			cheer: '100 days straight',
			fact: 'agents are unionizing',
		},
	],
	[
		365,
		{
			icon: 'sun',
			tone: 'text-warning-content',
			cheer: 'A whole year',
			fact: 'agents threw a party',
		},
	],
]);

export function momentBadge(moment: StatsMoment): MomentBadge {
	const count = formatCount(moment.count);
	if (moment.kind === 'streak') {
		return (
			STREAK_BADGES.get(moment.count) ?? {
				icon: 'trophy',
				tone: 'text-success-content',
				cheer: `${count} days straight`,
				fact: 'agents are impressed',
			}
		);
	}
	if (moment.kind === 'best-day') {
		return {
			icon: 'trend-up',
			tone: 'text-brand-icon',
			cheer: `${count} runs in a day`,
			fact: 'agents need a nap',
		};
	}
	return {
		icon: 'sparkles',
		tone: 'text-brand-icon',
		cheer: `${count} runs`,
		fact: 'agents want a raise',
	};
}

export function momentLabel(moment: StatsMoment): string {
	const { cheer, fact } = momentBadge(moment);
	return `${cheer}, ${fact}`;
}

export function momentTitle(moment: StatsMoment): string {
	const { cheer, fact } = momentBadge(moment);
	return `${cheer}. ${fact.charAt(0).toUpperCase()}${fact.slice(1)}.`;
}
