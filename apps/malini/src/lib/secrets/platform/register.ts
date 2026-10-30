import { randomUUID } from 'node:crypto';
import { REPOSITORY_FULL_NAME_MAX_LENGTH } from '$contract/scratchpad';
import {
	SECRETS_DELETED_CHANNEL,
	SECRETS_REQUEST_DISMISSED_CHANNEL,
	SECRETS_REQUESTED_CHANNEL,
	SECRETS_SAVED_CHANNEL,
} from '$contract/events';
import { SECRET_VALUE_MAX_LENGTH, type SecretRequest } from '$contract/secrets';
import type { MainContext } from '$main/context';
import { isRecord, nowIso8601 } from '$main/db/rows';
import { secretNameProblem } from '../domain/secret-name';
import { Keychain, type SecretSealer } from './keychain';
import {
	getSecretRequest,
	insertSecretRequest,
	openSecretRequests,
	settleSecretRequest,
	type SecretRequestRecord,
} from './secret-requests.repository';

export type SecretsPlatformDeps = Readonly<{ sealer: SecretSealer }>;

export type AskedSecrets = Readonly<{
	sessionId: string;
	repository: string | null;
	names: unknown;
	why: unknown;
}>;

export type SecretsPlatform = Readonly<{
	request(asked: AskedSecrets): Readonly<Record<string, unknown>>;
	valuesReaching(repository: string | null): Record<string, string>;
}>;

type SecretsContext = Pick<MainContext, 'db' | 'events'>;

type Input = Readonly<Record<string, unknown>>;

const NAMES_PER_REQUEST = 10;
const WHY_MAX_LENGTH = 300;

export function registerSecrets(context: MainContext, deps: SecretsPlatformDeps): SecretsPlatform {
	const { db, commands } = context;
	const keychain = new Keychain(db, deps.sealer);

	commands.define('secrets.list-requests', (args: unknown) =>
		openSecretRequests(db, requiredText(record(args), 'sessionId')).map((request) =>
			shown(keychain, request),
		),
	);
	commands.define('secrets.save', (args: unknown) => saveSecrets(context, keychain, record(args)));
	commands.define('secrets.dismiss-request', (args: unknown) =>
		dismissRequest(context, requiredText(record(args), 'requestId')),
	);
	commands.define('secrets.list', () => keychain.list());
	commands.define('secrets.delete', (args: unknown) =>
		removeSecret(context, keychain, record(args)),
	);

	return {
		request: (asked) => requestSecrets(context, keychain, asked),
		valuesReaching: (repository) => keychain.valuesReaching(repository),
	};
}

function requestSecrets(
	{ db, events }: SecretsContext,
	keychain: Keychain,
	asked: AskedSecrets,
): Readonly<Record<string, unknown>> {
	const names = askedNames(asked.names);
	const why = boundedText(asked.why, 'why', WHY_MAX_LENGTH);
	const open = openSecretRequests(db, asked.sessionId);
	const askedAt = nowIso8601();
	const request = {
		id: randomUUID(),
		sessionId: asked.sessionId,
		names: [...new Set([...open.flatMap((earlier) => earlier.names), ...names])],
		why,
		repository: asked.repository,
		askedAt,
	};
	db.transaction(() => {
		for (const earlier of open) settleSecretRequest(db, earlier.id, 'replaced', askedAt);
		insertSecretRequest(db, request);
	});
	const card = shown(keychain, { ...request, open: true });
	events.emit(SECRETS_REQUESTED_CHANNEL, { request: card });
	return {
		id: card.id,
		names: card.names,
		alreadySaved: card.saved,
		status:
			'The user sees a card in this chat with a field for each name. Malini tells you in a message once they save them.',
	};
}

function saveSecrets({ db, events }: SecretsContext, keychain: Keychain, input: Input): void {
	const values = secretValues(input['values']);
	const requestId = optionalText(input, 'requestId');
	const request = requestId === null ? null : getSecretRequest(db, requestId);
	if (requestId !== null && !request?.open) {
		throw new Error('That request is no longer waiting for secrets.');
	}
	if (request) refuseUnasked(request, values);
	const repository = request ? request.repository : repositoryName(input['repository']);
	keychain.save(repository, values);
	if (request) settleSecretRequest(db, request.id, 'saved', nowIso8601());
	events.emit(SECRETS_SAVED_CHANNEL, {
		names: Object.keys(values),
		unsaved: request ? request.names.filter((name) => !Object.hasOwn(values, name)) : [],
		repository,
		requestId: request?.id ?? null,
		sessionId: request?.sessionId ?? null,
	});
}

function dismissRequest({ db, events }: SecretsContext, requestId: string): void {
	const request = getSecretRequest(db, requestId);
	if (!request || !settleSecretRequest(db, requestId, 'dismissed', nowIso8601())) {
		throw new Error('That request is no longer waiting for secrets.');
	}
	events.emit(SECRETS_REQUEST_DISMISSED_CHANNEL, { requestId, sessionId: request.sessionId });
}

function removeSecret({ events }: SecretsContext, keychain: Keychain, input: Input): void {
	const name = requiredText(input, 'name');
	const repository = repositoryName(input['repository']);
	if (!keychain.delete(repository, name)) {
		throw new Error(
			`${name} is not saved ${repository === null ? 'for everywhere' : `for ${repository}`}.`,
		);
	}
	events.emit(SECRETS_DELETED_CHANNEL, { name, repository });
}

function shown(keychain: Keychain, request: SecretRequestRecord): SecretRequest {
	const saved = new Set(keychain.namesReaching(request.repository));
	return {
		id: request.id,
		sessionId: request.sessionId,
		names: request.names,
		why: request.why,
		repository: request.repository,
		saved: request.names.filter((name) => saved.has(name)),
		askedAt: request.askedAt,
	};
}

function refuseUnasked(
	request: SecretRequestRecord,
	values: Readonly<Record<string, string>>,
): void {
	const unasked = Object.keys(values).find((name) => !request.names.includes(name));
	if (unasked !== undefined) throw new Error(`${unasked} is not a name this chat asked for.`);
}

function askedNames(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > NAMES_PER_REQUEST) {
		throw new Error(`\`names\` must hold one to ${NAMES_PER_REQUEST} names.`);
	}
	return [...new Set(value.map((name: unknown) => validName(name)))];
}

function secretValues(value: unknown): Readonly<Record<string, string>> {
	if (!isRecord(value)) throw new Error('invalid args: `values` must map names to values');
	const entries = Object.entries(value).map(([name, secret]) => [validName(name), secret] as const);
	if (entries.length === 0) throw new Error('Paste at least one value before you save.');
	return Object.fromEntries(
		entries.map(([name, secret]) => {
			const trimmed = typeof secret === 'string' ? secret.trim() : '';
			if (trimmed.length === 0) throw new Error(`Paste a value for ${name} before you save.`);
			if (trimmed.length > SECRET_VALUE_MAX_LENGTH) {
				throw new Error(
					`The value for ${name} is longer than ${SECRET_VALUE_MAX_LENGTH} characters.`,
				);
			}
			return [name, trimmed];
		}),
	);
}

function validName(value: unknown): string {
	if (typeof value !== 'string') throw new Error('A secret name must be a string.');
	const problem = secretNameProblem(value);
	if (problem !== null) throw new Error(problem);
	return value;
}

function repositoryName(value: unknown): string | null {
	if (value === null) return null;
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > REPOSITORY_FULL_NAME_MAX_LENGTH
	) {
		throw new Error('invalid args: `repository` must be a repository name or null');
	}
	return value.trim();
}

function boundedText(value: unknown, key: string, maxLength: number): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (text.length === 0 || text.length > maxLength) {
		throw new Error(`\`${key}\` must be one to ${maxLength} characters.`);
	}
	return text;
}

function record(value: unknown): Input {
	return isRecord(value) ? value : {};
}

function requiredText(input: Input, key: string): string {
	const value = optionalText(input, key);
	if (value === null) throw new Error(`invalid args: \`${key}\` is required`);
	return value;
}

function optionalText(input: Input, key: string): string | null {
	const value = input[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`invalid args: \`${key}\` must be a string`);
	}
	return value.trim();
}
