export type SecretSave =
	Readonly<{ status: 'saving' }> | Readonly<{ status: 'failed'; error: string }>;

export function savedSecretKey(name: string, repository: string | null): string {
	return `${repository?.toLowerCase() ?? ''}\u0000${name}`;
}
