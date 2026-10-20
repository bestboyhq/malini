const PRAGMA =
	/^\s*(?:eslint|svelte-ignore|@ts-|@vite-ignore|@vitest-environment|ponytail:|\/\s*<reference)/u;

const TYPE_TAG =
	/^@(?:type|param|returns|typedef|property|satisfies|template|callback|overload|import)\b/u;

const TYPE_ONLY_LINE = /^@\w+(?:\s*\{.*\})?(?:\s+\[?[\w$.]+(?:=[^\]]*)?\]?)?\s*$/u;

/** @type {import('eslint').Rule.RuleModule} */
export const noComments = {
	meta: {
		type: 'problem',
		fixable: 'code',
		docs: { description: 'Disallow code comments.', recommended: true },
		schema: [],
		messages: {
			comment: 'Make the code self-explanatory instead of adding a comment.',
		},
	},
	create(context) {
		const sourceCode = context.sourceCode;
		const source = sourceCode.text;
		return {
			Program(node) {
				for (const comment of sourceCode.getAllComments()) {
					const range = comment.range;
					if (!range) continue;
					if (!isFlagged(comment.value)) continue;
					context.report({
						node,
						...(comment.loc ? { loc: comment.loc } : {}),
						messageId: 'comment',
						fix: (fixer) => removeComment(fixer, source, comment.type, comment.value, range),
					});
				}
			},
		};
	},
};

/**
 * @param {string} value
 * @returns {boolean}
 */
function isFlagged(value) {
	if (PRAGMA.test(value)) return false;
	const lines = contentLines(value);
	if (lines === null || lines.length === 0) return true;
	return !lines.every((line) => isKeeper(line));
}

/**
 * @param {string} value
 * @returns {string[] | null}
 */
function contentLines(value) {
	if (!value.startsWith('*')) return null;
	return value
		.slice(1)
		.split('\n')
		.map((line) => line.replace(/^\s*\*?\s*/u, '').trimEnd())
		.filter((line) => line.length > 0);
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isKeeper(line) {
	if (PRAGMA.test(line)) return true;
	return TYPE_TAG.test(line) && TYPE_ONLY_LINE.test(line);
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function typeTagLines(value) {
	const lines = contentLines(value);
	if (lines === null) return [];
	return lines.filter((line) => isKeeper(line));
}

/**
 * @param {import('eslint').Rule.RuleFixer} fixer
 * @param {string} source
 * @param {'Line' | 'Block'} type
 * @param {string} value
 * @param {[number, number]} range
 * @returns {import('eslint').Rule.Fix}
 */
function removeComment(fixer, source, type, value, range) {
	const lineStart = source.lastIndexOf('\n', range[0] - 1) + 1;
	const indent = source.slice(lineStart, range[0]);
	const ownLine = /^\s*$/u.test(indent);
	const kept = type === 'Block' ? typeTagLines(value) : [];
	if (kept.length > 0) {
		const rebuilt =
			kept.length === 1
				? `/** ${kept[0]} */`
				: `/**\n${kept.map((line) => `${indent} * ${line}`).join('\n')}\n${indent} */`;
		return fixer.replaceTextRange(range, rebuilt);
	}
	if (!ownLine) return fixer.removeRange([range[0], range[1]]);
	const newline = source.indexOf('\n', range[1]);
	const lineEnd = newline === -1 ? source.length : newline + 1;
	return fixer.removeRange([lineStart, lineEnd]);
}
