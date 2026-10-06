import { scanTokens } from './rule-helpers.mjs';

export { textParser };

/**
 * @param {string} source
 * @returns {number[]}
 */
const lineStartsOf = (source) => {
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === '\n') starts.push(index + 1);
	}
	return starts;
};

/**
 * @typedef {import('eslint').AST.SourceLocation['start']} Position
 * @typedef {(index: number) => Position} Locator
 * @typedef {import('eslint').AST.Program['comments'][number]} Comment
 */

/**
 * @param {string} source
 * @returns {Locator}
 */
const locatorFor = (source) => {
	const starts = lineStartsOf(source);
	return (index) => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			const midStart = starts[mid];
			if (midStart !== undefined && midStart <= index) low = mid;
			else high = mid - 1;
		}
		return { line: low + 1, column: index - (starts[low] ?? 0) };
	};
};

/**
 * @param {string} source
 * @param {Locator} locate
 * @returns {Comment[]}
 */
const commentsIn = (source, locate) => {
	/** @type {Comment[]} */
	const comments = [];
	for (const token of scanTokens(source)) {
		if (token.kind !== 'comment') continue;
		comments.push({
			type: token.type,
			value: token.value,
			range: [token.start, token.end],
			loc: { start: locate(token.start), end: locate(token.end) },
		});
	}
	return comments;
};

/** @type {import('eslint').Linter.ESTreeParser} */
const textParser = {
	meta: {
		name: 'text-parser',
		version: '2.0.0',
	},
	/**
	 * @param {string} sourceCode
	 * @returns {import('eslint').Linter.ESLintParseResult}
	 */
	parseForESLint(sourceCode) {
		const locate = locatorFor(sourceCode);
		return {
			ast: {
				type: 'Program',
				body: [],
				sourceType: 'module',
				tokens: [],
				comments: commentsIn(sourceCode, locate),
				range: [0, sourceCode.length],
				loc: {
					start: { line: 1, column: 0 },
					end: locate(sourceCode.length),
				},
			},
			services: {},
			visitorKeys: {
				Program: ['body'],
			},
		};
	},
};
