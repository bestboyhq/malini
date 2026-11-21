const BUILTIN_ERRORS = new Set([
	'Error',
	'TypeError',
	'RangeError',
	'SyntaxError',
	'ReferenceError',
	'EvalError',
	'URIError',
	'AggregateError',
]);

const BASE_CLASS = 'MaliniError';

/** @type {import('eslint').Rule.RuleModule} */
export const noUntypedThrow = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require a named MaliniError with a kind in main-process code instead of a plain Error.',
		},
		schema: [],
		messages: {
			plainError:
				'Use a named error of this domain that extends MaliniError and give it a kind, not a plain {{name}}.',
			plainSubclass: 'Extend MaliniError so this error carries a kind and a verdict.',
		},
	},
	create(context) {
		/**
		 * @param {import('eslint').Rule.Node} node
		 * @param {import('eslint').Rule.Node['parent']} parent
		 * @param {string | null} callee
		 */
		const checkConstruction = (node, parent, callee) => {
			if (callee === null || !BUILTIN_ERRORS.has(callee)) return;
			if (isCauseValue(node, parent)) return;
			context.report({ node, messageId: 'plainError', data: { name: callee } });
		};
		/**
		 * @param {import('eslint').Rule.Node} superClass
		 * @param {string | null} superName
		 * @param {string | null} className
		 */
		const checkClass = (superClass, superName, className) => {
			if (superName === null || !BUILTIN_ERRORS.has(superName)) return;
			if (className === BASE_CLASS) return;
			context.report({ node: superClass, messageId: 'plainSubclass' });
		};
		return {
			NewExpression(node) {
				checkConstruction(node, node.parent, identifierName(node.callee));
			},
			CallExpression(node) {
				checkConstruction(node, node.parent, identifierName(node.callee));
			},
			ClassDeclaration(node) {
				if (node.superClass)
					checkClass(node, identifierName(node.superClass), node.id?.name ?? null);
			},
			ClassExpression(node) {
				if (node.superClass)
					checkClass(node, identifierName(node.superClass), node.id?.name ?? null);
			},
		};
	},
};

/**
 * @param {{ type: string; name?: string }} node
 * @returns {string | null}
 */
function identifierName(node) {
	return node.type === 'Identifier' && typeof node.name === 'string' ? node.name : null;
}

/**
 * @param {import('eslint').Rule.Node} node
 * @param {import('eslint').Rule.Node['parent']} parent
 * @returns {boolean}
 */
function isCauseValue(node, parent) {
	if (parent === null || parent.type !== 'Property' || parent.value !== node) return false;
	return parent.key.type === 'Identifier' && parent.key.name === 'cause';
}
