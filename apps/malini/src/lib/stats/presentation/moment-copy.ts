import type { StatsMoment } from '$contract/stats';
import { formatCount } from './stats-format';

const STREAK_CHEERS: ReadonlyMap<number, string> = new Map([
	[7, "You're on fire"],
	[30, 'Unstoppable'],
	[100, 'Legendary'],
	[365, 'A whole year'],
]);

export function momentLabel(moment: StatsMoment): string {
	const count = formatCount(moment.count);
	if (moment.kind === 'streak') {
		return `${STREAK_CHEERS.get(moment.count) ?? 'New record'} · ${count}-day streak`;
	}
	if (moment.kind === 'best-day') return `Best day yet · ${count} runs`;
	return `${count} runs and counting`;
}

export function momentTitle(moment: StatsMoment): string {
	if (moment.kind === 'streak') return `Share your ${formatCount(moment.count)}-day streak`;
	if (moment.kind === 'best-day') return 'Share your best day';
	return `Share ${formatCount(moment.count)} agent runs`;
}
