export { noMismatchedSurfaceBorder };

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	fixable: 'code',
	docs: {
		description:
			'Disallow pairing a surface background with a foreign border color. An element with bg-surface-X must use its matching surface border (border-surface-X-border), or border-border-default for surface-root.',
		recommended: false,
	},
	schema: [],
	messages: {
		mismatch:
			'"{{border}}" does not match "bg-surface-{{surface}}" on the same element. Use "{{expected}}" for this surface\'s own border (border-border-* / border-surface-Y-border belong to dividers or other surfaces).',
	},
};

const SURFACES_WITHOUT_BORDER = new Set(['root']);

/** @param {string} surface */
function expectedBorder(surface) {
	return SURFACES_WITHOUT_BORDER.has(surface)
		? 'border-border-default'
		: `border-surface-${surface}-border`;
}

const SURFACE_BG =
	/(?<![:\w-])bg-surface-(?<surface>root|50|100|150|elevated|modal|tooltip|toast|input)(?![\w-])/g;

const BORDER_COLOR =
	/(?<![:\w-])border-(?<border>border-(?:default|subtle)|surface-[\w-]+-border|chip-border|button-secondary-border)(?:\/\d+)?(?![\w-])/g;

/** @param {string} text */
function* classRegions(text) {
	const re = /class\s*=\s*/g;
	while (re.exec(text) !== null) {
		const i = re.lastIndex;
		const ch = text[i];
		if (ch === '"' || ch === "'") {
			const end = text.indexOf(ch, i + 1);
			if (end === -1) {
				continue;
			}
			yield { start: i + 1, body: text.slice(i + 1, end) };
			re.lastIndex = end + 1;
		} else if (ch === '{') {
			let depth = 0;
			let j = i;
			for (; j < text.length; j++) {
				if (text[j] === '{') {
					depth++;
				} else if (text[j] === '}' && --depth === 0) {
					j++;
					break;
				}
			}
			yield { start: i + 1, body: text.slice(i + 1, j - 1) };
			re.lastIndex = j;
		}
	}
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
		Program(_node) {
			const sourceCode = context.sourceCode;
			const text = sourceCode.getText();

			for (const region of classRegions(text)) {
				/** @type {Set<string>} */
				const surfaces = new Set();
				for (const surfaceMatch of region.body.matchAll(SURFACE_BG)) {
					const surface = surfaceMatch.groups?.surface;
					if (surface) {
						surfaces.add(surface);
					}
				}
				if (surfaces.size === 0) {
					continue;
				}

				const firstSurface = [...surfaces][0];
				if (!firstSurface) {
					continue;
				}

				const allowed = new Set([...surfaces].map(expectedBorder));
				const fixTo = expectedBorder(firstSurface);

				for (const match of region.body.matchAll(BORDER_COLOR)) {
					const fullToken = match[0];
					const border = match.groups?.border;
					if (!border) {
						continue;
					}
					const borderName = `border-${border}`;
					if (allowed.has(borderName)) {
						continue;
					}

					const absStart = region.start + (match.index ?? 0);
					const absEnd = absStart + fullToken.length;

					context.report({
						loc: {
							start: sourceCode.getLocFromIndex(absStart),
							end: sourceCode.getLocFromIndex(absEnd),
						},
						messageId: 'mismatch',
						data: {
							border: fullToken,
							surface: firstSurface,
							expected: fixTo,
						},
						fix: (fixer) => fixer.replaceTextRange([absStart, absEnd], fixTo),
					});
				}
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noMismatchedSurfaceBorder = {
	meta,
	create,
};
