import { secretNameProblem } from '$lib/secrets/domain/secret-name';
import { pastedPair, type PastedPair } from '$lib/secrets/domain/secret-paste';

export type FoundSecret = Readonly<{ value: string; label: string; name: string }>;

export type NamedSecret = Readonly<{ value: string; name: string }>;

export type PastedSecretState = 'keeping' | 'kept' | 'shown';

export type PastedSecret = Readonly<{
	id: string;
	draftScope: string;
	workstreamId: string;
	label: string;
	value: string;
	name: string;
	repository: string | null;
	created: boolean;
	state: PastedSecretState;
	failure: string | null;
}>;

export type SecretPaste = Readonly<{
	key: string;
	draftScope: string;
	workstreamId: string;
	text: string;
}>;

export type SecretPasteLanding = Readonly<{ draftScope: string; text: string }>;

type SecretShape = Readonly<{ label: string; name: string; pattern: RegExp }>;

const SHAPES: readonly SecretShape[] = [
	token('GitHub token', 'GITHUB_TOKEN', 'gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}'),
	token('GitLab token', 'GITLAB_TOKEN', 'glpat-[A-Za-z0-9_-]{20,}'),
	token('Anthropic key', 'ANTHROPIC_API_KEY', 'sk-ant-[A-Za-z0-9_-]{32,}'),
	token('OpenAI key', 'OPENAI_API_KEY', 'sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{32,}'),
	token('Stripe key', 'STRIPE_SECRET_KEY', '[rs]k_(?:live|test)_[A-Za-z0-9]{24,}'),
	token('Slack token', 'SLACK_TOKEN', 'xox[abposr]-[A-Za-z0-9-]{10,}'),
	token('Google API key', 'GOOGLE_API_KEY', 'AIza[A-Za-z0-9_-]{35}'),
	{
		label: 'private key',
		name: 'PRIVATE_KEY',
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/gu,
	},
];

const SECRET_NAME =
	/(?:TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL|DSN)S?(?:_|$)|(?:^|_)(?:PASS|PAT|AUTH)(?:_|$)/iu;
const PUBLIC_NAME = /PUBLIC|PUBLISHABLE/iu;
const PLACEHOLDER =
	/^(?:<.*>|\$.*|\{\{.*\}\}|x{3,}|\*{3,}|\.{3,}|changeme|your[-_].*|example.*|true|false|null)$/iu;
const MIN_PAIRED_VALUE_LENGTH = 8;

export function secretsIn(text: string): FoundSecret[] {
	const found = new Map<string, FoundSecret>();
	for (const line of text.split(/\r?\n/u)) {
		const pair = pastedPair(line);
		if (pair === null || !holdsSecret(pair) || found.has(pair.value)) continue;
		found.set(pair.value, { value: pair.value, label: 'secret', name: pair.name.toUpperCase() });
	}
	for (const { label, name, pattern } of SHAPES) {
		for (const [value] of text.matchAll(pattern)) {
			if (!found.has(value)) found.set(value, { value, label, name });
		}
	}
	return [...found.values()];
}

export function withSecretNames(text: string, named: readonly NamedSecret[]): string {
	return [...named]
		.sort((left, right) => right.value.length - left.value.length)
		.reduce((swapped, { value, name }) => swapped.replaceAll(value, () => `$${name}`), text);
}

export function withSecretValues(text: string, named: readonly NamedSecret[]): string {
	return named.reduce(
		(revealed, { value, name }) => revealed.replace(nameReference(name), () => value),
		text,
	);
}

export function holdsSecretName(text: string, name: string): boolean {
	return nameReference(name).test(text);
}

export function pastedSecretInText(secret: PastedSecret, text: string): boolean {
	return holdsSecretName(text, secret.name) || text.includes(secret.value);
}

export function sentenceLabel(label: string): string {
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function holdsSecret({ name, value }: PastedPair): boolean {
	return (
		SECRET_NAME.test(name) &&
		!PUBLIC_NAME.test(name) &&
		secretNameProblem(name.toUpperCase()) === null &&
		value.length >= MIN_PAIRED_VALUE_LENGTH &&
		!/\s/u.test(value) &&
		!PLACEHOLDER.test(value)
	);
}

function nameReference(name: string): RegExp {
	return new RegExp(`\\$${name}(?![A-Za-z0-9_])`, 'gu');
}

function token(label: string, name: string, pattern: string): SecretShape {
	return {
		label,
		name,
		pattern: new RegExp(`(?<![A-Za-z0-9_-])(?:${pattern})(?![A-Za-z0-9_-])`, 'gu'),
	};
}
