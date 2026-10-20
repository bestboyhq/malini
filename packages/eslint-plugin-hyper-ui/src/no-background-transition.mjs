export { noBackgroundTransition };

import { isNonProductFile, maskComments } from './design-system-file-scope.mjs';
import { scanTokens } from './rule-helpers.mjs';

/**
 * @type {import('eslint').Rule.RuleMetaData}
 */
const meta = {
	type: 'problem',
	docs: {
		description:
			'Disallow transitions that animate background-color. Background changes are instant; transition only the properties that should ease.',
		recommended: true,
	},
	schema: [],
	messages: {
		backgroundTransition:
			'"{{source}}" animates background-color. Background changes must be instant: transition only color, border-color, opacity, transform or similar, e.g. transition-[color,border-color], or drop the transition.',
	},
};

const BACKGROUND_OR_ALL = /(?<![\w-])(?:all|background|background-color)(?![\w-])/;
const CLASS_TOKEN =
	/(?<![\w$#.@/-])(?<!\$\{)transition(?<suffix>-colors|-all|-\[[^\]\s]*\])?(?![\w:[(-])/g;
const CLASS_WORD = /^[^;"'`{}]*[^;.,:"'`{}]$/;
const UTILITY_SHAPE = /^(?:[\w-]+:)*-?[a-z][\w]*-[\w./[\]%-]+$/;
const CSS_DECLARATION =
	/(?<![\w$#.-])(?<property>transition(?:-property)?)\s*:(?<value>[^;{}"'`>]*)/g;
const APPLY_DIRECTIVE = /@apply\s[^;}]*/g;
const FUNCTION_CALL = /[\w-]+\([^()]*\)/g;
const TIME = /(?<![\w-])\d*\.?\d+m?s(?![\w-])/;
const TIMING_KEYWORDS = new Set([
	'ease',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'linear',
	'step-start',
	'step-end',
	'allow-discrete',
	'normal',
]);

/**
 * @param {string} list
 * @returns {string[]}
 */
const topLevelItems = (list) => {
	const items = [''];
	let depth = 0;
	for (const char of list) {
		if (char === '(') depth += 1;
		if (char === ')') depth -= 1;
		if (char === ',' && depth === 0) items.push('');
		else items[items.length - 1] += char;
	}
	return items.map((item) => item.trim());
};

/**
 * @param {string} item
 */
const transitionsEverything = (item) => {
	if (BACKGROUND_OR_ALL.test(item)) return true;
	const bare = item.replace(FUNCTION_CALL, ' 0s ');
	if (!TIME.test(bare)) return false;
	return bare
		.split(/\s+/)
		.filter((word) => word !== '' && !TIME.test(word) && !TIMING_KEYWORDS.has(word))
		.every((word) => !/^[a-z-]+$/i.test(word));
};

/**
 * @param {string} property
 * @param {string} value
 */
const declarationAnimatesBackground = (property, value) => {
	if (value.includes('$')) return false;
	if (property === 'transition-property') return BACKGROUND_OR_ALL.test(value);
	return topLevelItems(value).some((item) => item !== '' && transitionsEverything(item));
};

/**
 * @param {string} suffix
 */
const utilityAnimatesBackground = (suffix) =>
	suffix === '-colors' ||
	suffix === '-all' ||
	(suffix.startsWith('-[') &&
		topLevelItems(suffix.slice(2, -1)).some((item) => BACKGROUND_OR_ALL.test(item)));

/**
 * @param {string} classList
 */
const looksLikeClassList = (classList) => {
	const words = classList
		.slice(1, -1)
		.replace(/\$?\{[^{}]*\}/g, ' ')
		.split(/\s+/)
		.filter((word) => word !== '');
	return (
		words.every((word) => CLASS_WORD.test(word)) &&
		words.some((word) => word !== 'transition' && UTILITY_SHAPE.test(word))
	);
};

/**
 * @param {string} text
 * @param {number} offset
 * @param {boolean} classContext
 * @returns {Generator<{ index: number, source: string }>}
 */
function* bareTransitions(text, offset, classContext) {
	if (!classContext && !looksLikeClassList(text)) return;
	for (const match of text.matchAll(CLASS_TOKEN)) {
		if (!match.groups?.suffix) yield { index: offset + (match.index ?? 0), source: match[0] };
	}
}

/**
 * @param {string} source
 * @returns {Generator<{ index: number, source: string }>}
 */
function* violations(source) {
	const text = maskComments(source);
	for (const match of text.matchAll(CLASS_TOKEN)) {
		const suffix = match.groups?.suffix ?? '';
		if (suffix !== '' && utilityAnimatesBackground(suffix)) {
			yield { index: match.index ?? 0, source: match[0] };
		}
	}
	for (const token of scanTokens(text)) {
		if (token.kind === 'string') {
			yield* bareTransitions(text.slice(token.start, token.end), token.start, false);
		}
	}
	for (const match of text.matchAll(APPLY_DIRECTIVE)) {
		yield* bareTransitions(match[0], match.index ?? 0, true);
	}
	for (const match of text.matchAll(CSS_DECLARATION)) {
		const property = match.groups?.property ?? '';
		const value = match.groups?.value ?? '';
		if (declarationAnimatesBackground(property, value)) {
			yield { index: match.index ?? 0, source: `${property}:${value.replace(/\s+/g, ' ')}` };
		}
	}
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @returns {import('eslint').Rule.RuleListener}
 */
const create = (context) => {
	if (isNonProductFile(context.filename)) return {};

	return {
		Program(node) {
			const sourceCode = context.sourceCode;
			const reported = new Set();
			for (const violation of violations(sourceCode.getText())) {
				if (reported.has(violation.index)) continue;
				reported.add(violation.index);
				context.report({
					node,
					loc: sourceCode.getLocFromIndex(violation.index),
					messageId: 'backgroundTransition',
					data: { source: violation.source.trim() },
				});
			}
		},
	};
};

/** @type {import('eslint').Rule.RuleModule} */
const noBackgroundTransition = { meta, create };
