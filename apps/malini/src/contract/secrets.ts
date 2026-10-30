export type SecretRequest = Readonly<{
	id: string;
	sessionId: string;
	names: readonly string[];
	why: string;
	repository: string | null;
	saved: readonly string[];
	askedAt: string;
}>;

export type SavedSecret = Readonly<{
	name: string;
	repository: string | null;
	savedAt: string;
}>;

export type ListSecretRequestsArgs = Readonly<{ sessionId: string }>;

export type SaveSecretsArgs = Readonly<
	{ values: Readonly<Record<string, string>> } & (
		| { requestId: string }
		| { repository: string | null }
	)
>;

export type DismissSecretRequestArgs = Readonly<{ requestId: string }>;

export type DeleteSecretArgs = Readonly<{ name: string; repository: string | null }>;

export type SecretsRequestedEvent = Readonly<{ request: SecretRequest }>;

export type SecretsSavedEvent = Readonly<{
	names: readonly string[];
	unsaved: readonly string[];
	repository: string | null;
	requestId: string | null;
	sessionId: string | null;
}>;

export type SecretRequestDismissedEvent = Readonly<{ requestId: string; sessionId: string }>;

export type SecretDeletedEvent = Readonly<{ name: string; repository: string | null }>;

export const SECRET_VALUE_MAX_LENGTH = 65_536;
