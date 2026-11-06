import { prefersReducedMotion } from 'svelte/motion';

export const motionOff = (): boolean => prefersReducedMotion.current || document.hidden;
