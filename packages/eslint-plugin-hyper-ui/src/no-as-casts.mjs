import { createTextRule, maskCode } from './rule-helpers.mjs';

const AS_CAST =
	/\bas\s+(?!const\b)(?:unknown\b|any\b|never\b|readonly\b|[A-Z_$][\w$]*(?:\s*<|\s*\[|\s*\||\s*&|\b))/gu;

export const noAsCasts = createTextRule({
	description: 'Disallow TypeScript as-casts while preserving const assertions.',
	messageId: 'asCast',
	message: 'Fix the type boundary instead of using an as-cast.',
	findMatches(source) {
		const masked = maskCode(source);
		return Array.from(masked.matchAll(AS_CAST), (match) => match.index ?? 0).filter(
			(index) => !isImportOrExportAlias(masked, index),
		);
	},
});

/**
 * @param {string} masked
 * @param {number} index
 * @returns {boolean}
 */
function isImportOrExportAlias(masked, index) {
	const before = masked.slice(0, index);
	const keyword = Math.max(before.lastIndexOf('import'), before.lastIndexOf('export'));
	if (keyword === -1) return false;
	return /^(?:import|export)\s*(?:type\s+)?(?:\{[^;}]*|\*\s*)$/u.test(before.slice(keyword));
}
