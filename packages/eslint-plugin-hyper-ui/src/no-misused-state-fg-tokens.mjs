export { noMisusedStateFgTokens };

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Enforce state-specific fg tokens. text-fg-placeholder and text-fg-disabled must stay behind their matching state variants, and placeholder variants must use text-fg-placeholder.',
		recommended: false,
	},
	schema: [],
	messages: {
		missingPrefix:
			'"{{token}}" must only be used behind the "{{prefix}}:" variant. Found variants: [{{found}}].',
		placeholderText:
			'"{{token}}" is not allowed behind placeholder:. Use a placeholder foreground token - text-fg-placeholder, or one of its state siblings such as text-fg-composer-placeholder-focus.',
	},
};

/** @type {Record<string, string>} */
const STATE_TOKEN_RULES = {
	'text-fg-placeholder': 'placeholder',
	'text-fg-disabled': 'disabled',
};

const STATE_TOKEN_REGEX = new RegExp(
	`\\b(?<token>${Object.keys(STATE_TOKEN_RULES).join('|')})\\b`,
	'g',
);

const TEXT_UTILITY_REGEX =
	/\b(?<utility>(?:(?:[\w-]+(?:\[[^\]]*\])?(?:\/[\w-]+)?):)*(?<token>text-(?:[\w-]+|\[[^\]]+\])(?:\/\d+)?))\b/g;

const VARIANT_CHAIN_REGEX = /(?:[\w-]+(?:\[[^\]]*\])?(?:\/\w+)?:)+$/;

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
 * @param {string} text
 * @param {number} index
 * @returns {string[]}
 */
function getVariantChain(text, index) {
	const before = text.substring(Math.max(0, index - 200), index);
	const match = before.match(VARIANT_CHAIN_REGEX);
	if (!match) {
		return [];
	}
	return match[0].split(':').filter(Boolean);
}

/**
 * @param {string} utility
 * @returns {string[]}
 */
function getUtilityVariantChain(utility) {
	return utility.split(':').slice(0, -1);
}

/**
 * @param {string} token
 */
function getTokenName(token) {
	return token.split('/')[0] ?? token;
}

/** @param {string} token */
function isPlaceholderForeground(token) {
	return /^text-fg-[\w-]*placeholder[\w-]*$/.test(getTokenName(token));
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

			for (const match of text.matchAll(STATE_TOKEN_REGEX)) {
				const token = match.groups?.token ?? match[0];
				const requiredPrefix = STATE_TOKEN_RULES[token];
				if (!requiredPrefix) {
					continue;
				}

				const index = match.index ?? 0;
				const chain = getVariantChain(text, index);
				if (chain.includes(requiredPrefix)) {
					continue;
				}

				context.report({
					node,
					loc: sourceCode.getLocFromIndex(index),
					messageId: 'missingPrefix',
					data: {
						token,
						prefix: requiredPrefix,
						found: chain.join(', '),
					},
				});
			}

			for (const match of text.matchAll(TEXT_UTILITY_REGEX)) {
				const utility = match.groups?.utility ?? match[0];
				const token = match.groups?.token ?? match[0];
				const chain = getUtilityVariantChain(utility);
				if (!chain.includes('placeholder') || isPlaceholderForeground(token)) {
					continue;
				}

				const index = match.index ?? 0;
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(index),
					messageId: 'placeholderText',
					data: { token },
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noMisusedStateFgTokens = {
	meta,
	create,
};
