export { noSurfaceTokenBorderUsage };

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow surface background tokens with border-like utilities. Use explicit *-border tokens for borders, rings, dividers, and outlines.',
		recommended: false,
	},
	schema: [],
	messages: {
		surfaceBorder:
			'"{{token}}" is not allowed. surface-* tokens are background tokens; use {{replacement}} for border-like utilities.',
	},
};

const SURFACE_BORDER_TOKEN =
	/\b(?<token>(?<utility>border|ring|divide|outline)-(?<surface>surface-(?:root|100|elevated|modal|tooltip|toast|input))(?!-(?:border|hover|selected)\b)(?:\/\d+)?)\b/g;

/**
 * @param {string} utility
 * @param {string} surface
 */
function getReplacement(utility, surface) {
	if (surface === 'surface-root') {
		return `${utility}-border-default`;
	}

	return `${utility}-${surface}-border`;
}

/**
 * @param {string} filename
 */
function shouldSkip(filename) {
	const normalized = filename.replace(/\\/g, '/');
	return (
		!normalized.includes('/apps/malini/src/') ||
		normalized.includes('/domain/') ||
		normalized.includes('/lib/paraglide/')
	);
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	const filename = context.filename;
	if (shouldSkip(filename)) {
		return {};
	}

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const text = sourceCode.getText();

			for (const match of text.matchAll(SURFACE_BORDER_TOKEN)) {
				const token = match.groups?.token ?? match[0];
				const utility = match.groups?.utility ?? '';
				const surface = match.groups?.surface ?? '';
				const index = match.index ?? 0;

				context.report({
					node,
					loc: sourceCode.getLocFromIndex(index),
					messageId: 'surfaceBorder',
					data: {
						token,
						replacement: getReplacement(utility, surface),
					},
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noSurfaceTokenBorderUsage = {
	meta,
	create,
};
