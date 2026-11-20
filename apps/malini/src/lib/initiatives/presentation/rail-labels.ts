import { dateOf } from '$lib/initiatives/domain/initiative';

export function weekdayOf(day: string): string {
	return dateOf(day).toLocaleString('en-US', { weekday: 'short' });
}

export function dayName(day: string): string {
	const date = dateOf(day);
	return `${weekdayOf(day)} ${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
}
