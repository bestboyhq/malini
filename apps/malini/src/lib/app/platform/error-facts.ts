import { createHash } from 'node:crypto';
import { CHECKOUT_FINDINGS } from '$contract/repositories';
import type { ErrorFacts } from '$main/errors';
import {
	GH_SAID,
	GH_SUBCOMMANDS,
	GIT_SAID,
	GIT_SUBCOMMANDS,
	SIGNAL_NAMES,
	isGitMessageTemplate,
} from '$main/failure-facts';

type FactCheck = (value: string | number) => boolean;

const oneOf = (values: readonly string[]): FactCheck => {
	const known = new Set(values);
	return (value) => typeof value === 'string' && known.has(value);
};

const CLOSED_FACTS: ReadonlyMap<string, FactCheck> = new Map<string, FactCheck>([
	['subcommand', oneOf([...GIT_SUBCOMMANDS, ...GH_SUBCOMMANDS])],
	['said', oneOf([...GIT_SAID, ...GH_SAID])],
	['signal', oneOf(SIGNAL_NAMES)],
	['finding', oneOf(CHECKOUT_FINDINGS)],
	['exit', (value) => Number.isInteger(value)],
	['template', (value) => typeof value === 'string' && isGitMessageTemplate(value)],
]);

export function sendableFacts(facts: ErrorFacts): ErrorFacts {
	return Object.fromEntries(
		Object.entries(facts).filter(([key, value]) => CLOSED_FACTS.get(key)?.(value) === true),
	);
}

export function factsOf(error: unknown): ErrorFacts {
	const facts: unknown =
		typeof error === 'object' && error !== null ? Reflect.get(error, 'facts') : undefined;
	if (typeof facts !== 'object' || facts === null) return {};
	return Object.fromEntries(
		Object.entries(facts).filter(
			(entry): entry is [string, string | number] =>
				typeof entry[1] === 'string' || typeof entry[1] === 'number',
		),
	);
}

export type FingerprintParts = Readonly<{
	scope: string;
	name: string;
	code: string | null;
	kind: string | null;
	said: string | number | undefined;
	stack: readonly string[];
}>;

export function errorFingerprint(parts: FingerprintParts): string {
	const files = parts.stack.map((site) => site.replace(/:\d+$/u, ''));
	const input = [parts.scope, parts.name, parts.code, parts.kind, parts.said ?? null, ...files];
	return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 12);
}
