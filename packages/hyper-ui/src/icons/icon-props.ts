import type { ClassValue } from 'svelte/elements';

export interface IconProps {
	class?: ClassValue;
	size?: number;
	ariaLabel?: string;
}

export function iconLabel(ariaLabel: string | undefined): {
	role?: 'img';
	'aria-label'?: string;
	'aria-hidden'?: 'true';
} {
	return ariaLabel === undefined
		? { 'aria-hidden': 'true' }
		: { role: 'img', 'aria-label': ariaLabel };
}
