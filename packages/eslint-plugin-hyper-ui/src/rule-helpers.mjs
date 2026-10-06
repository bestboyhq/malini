export { createTextRule, maskCode, reportMatches, scanTokens };

/**
 * @typedef {object} TextRuleOptions
 * @property {string} description
 * @property {string} messageId
 * @property {string} message
 * @property {(source: string) => Iterable<number>} findMatches
 */

/**
 * @param {TextRuleOptions} options
 * @returns {import('eslint').Rule.RuleModule}
 */
function createTextRule({ description, messageId, message, findMatches }) {
	return {
		meta: {
			type: 'problem',
			docs: { description, recommended: true },
			schema: [],
			messages: { [messageId]: message },
		},
		create(context) {
			return {
				Program(node) {
					reportMatches(context, node, messageId, findMatches(context.sourceCode.getText()));
				},
			};
		},
	};
}

/**
 * @param {string} source
 * @returns {string}
 */
function maskCode(source) {
	const out = [...source];
	for (const token of scanTokens(source)) {
		for (let index = token.start; index < token.end; index += 1) {
			if (source[index] !== '\n') out[index] = ' ';
		}
	}
	return out.join('');
}

/**
 * @typedef {object} ScannedToken
 * @property {'comment' | 'string'} kind
 * @property {'Line' | 'Block'} type
 * @property {number} start
 * @property {number} end
 * @property {string} value
 */

/**
 * @param {string} source
 * @returns {Generator<ScannedToken>}
 */
function* scanTokens(source) {
	const length = source.length;
	let index = 0;
	while (index < length) {
		const char = source[index];
		const next = source[index + 1];
		if (char === '/' && next === '/') {
			const start = index;
			while (index < length && source[index] !== '\n') index += 1;
			yield {
				kind: 'comment',
				type: 'Line',
				start,
				end: index,
				value: source.slice(start + 2, index),
			};
			continue;
		}
		if (char === '/' && next === '*') {
			const start = index;
			index += 2;
			while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
			const value = source.slice(start + 2, index);
			if (index < length) index += 2;
			yield { kind: 'comment', type: 'Block', start, end: index, value };
			continue;
		}
		if (char === '<' && source.startsWith('<!--', index)) {
			const start = index;
			index += 4;
			while (index < length && !source.startsWith('-->', index)) index += 1;
			const value = source.slice(start + 4, index);
			if (index < length) index += 3;
			yield { kind: 'comment', type: 'Block', start, end: index, value };
			continue;
		}
		if (char === '"' || char === "'" || char === '`') {
			const quote = char;
			const start = index;
			index += 1;
			while (index < length) {
				const inner = source[index];
				if (inner === '\\') {
					index += 2;
					continue;
				}
				if (inner === quote) {
					index += 1;
					break;
				}
				if (inner === '\n' && quote !== '`') break;
				index += 1;
			}
			yield { kind: 'string', type: 'Block', start, end: index, value: '' };
			continue;
		}
		index += 1;
	}
}

/**
 * @param {import('eslint').Rule.RuleContext} context
 * @param {import('eslint').AST.Program} node
 * @param {string} messageId
 * @param {Iterable<number>} indexes
 */
function reportMatches(context, node, messageId, indexes) {
	for (const index of indexes) {
		context.report({
			node,
			loc: context.sourceCode.getLocFromIndex(index),
			messageId,
		});
	}
}
