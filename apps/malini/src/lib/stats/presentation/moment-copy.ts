import type { StatsMoment } from '$contract/stats';
import type { IconName } from '$hyper-ui/icons';
import { formatCount } from './stats-format';

type Cheer = Readonly<{ icon: IconName; tone: string; cheer: string }>;

export type MomentBadge = Cheer & Readonly<{ fact: string }>;

const STREAK_CHEERS: ReadonlyMap<number, Cheer> = new Map([
	[7, { icon: 'flame', tone: 'text-accent-2-primary', cheer: "You're on fire" }],
	[30, { icon: 'bolt', tone: 'text-warning-content', cheer: 'Unstoppable' }],
	[100, { icon: 'crown', tone: 'text-warning-content', cheer: 'Legendary' }],
	[365, { icon: 'sun', tone: 'text-warning-content', cheer: 'A whole year' }],
]);
const NEW_RECORD: Cheer = { icon: 'trophy', tone: 'text-success-content', cheer: 'New record' };

export function momentBadge(moment: StatsMoment): MomentBadge {
	const count = formatCount(moment.count);
	if (moment.kind === 'streak') {
		return { ...(STREAK_CHEERS.get(moment.count) ?? NEW_RECORD), fact: `${count}-day streak` };
	}
	if (moment.kind === 'best-day') {
		return {
			icon: 'trend-up',
			tone: 'text-brand-icon',
			cheer: 'Best day yet',
			fact: `${count} runs`,
		};
	}
	return {
		icon: 'sparkles',
		tone: 'text-brand-icon',
		cheer: `${count} runs`,
		fact: 'and counting',
	};
}

export function momentLabel(moment: StatsMoment): string {
	const { cheer, fact } = momentBadge(moment);
	return `${cheer}, ${fact}`;
}

export function momentTitle(moment: StatsMoment): string {
	if (moment.kind === 'streak') return `Share your ${formatCount(moment.count)}-day streak`;
	if (moment.kind === 'best-day') return 'Share your best day';
	return `Share ${formatCount(moment.count)} agent runs`;
}
