export { default as Sensitive } from './Sensitive.svelte';
export { default as SensitiveText } from './SensitiveText.svelte';
export { maskSensitiveHtml, maskSensitiveText, revealSensitiveTarget } from './sensitive-dom';
export {
	hasSensitiveText,
	sensitiveSegments,
	sensitiveSegmentsAcross,
	type SensitiveKind,
	type SensitiveSegment,
} from './sensitive-segments';
export { default as SensitiveFieldMask } from './SensitiveFieldMask.svelte';
