import type { StatsMoment } from '$contract/stats';
import { formatCount } from './stats-format';

export function momentLabel(moment: StatsMoment): string {
	if (moment.kind === 'streak') {
		return `${formatCount(moment.count)}-day streak${moment.longest ? ', your longest' : ''}`;
	}
	if (moment.kind === 'best-day')
		return `${formatCount(moment.count)} runs yesterday, your best day`;
	return `${formatCount(moment.count)} agent runs`;
}

export function momentTitle(moment: StatsMoment): string {
	if (moment.kind === 'streak') return `Share your ${formatCount(moment.count)}-day streak`;
	if (moment.kind === 'best-day') return 'Share your best day';
	return `Share ${formatCount(moment.count)} agent runs`;
}
