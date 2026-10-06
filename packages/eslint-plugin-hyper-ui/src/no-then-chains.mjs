import { createTextRule, maskCode } from './rule-helpers.mjs';

export const noThenChains = createTextRule({
	description: 'Require async and await instead of promise then chains.',
	messageId: 'thenChain',
	message: 'Use async and await instead of a .then() chain.',
	findMatches(source) {
		return Array.from(maskCode(source).matchAll(/\.\s*then\s*\(/gu), (match) => match.index ?? 0);
	},
});
