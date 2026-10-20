export type ExtensionRepositoryEnablement = Readonly<{
	enabled: boolean;
	loading: boolean;
	error: string | null;
	changing: boolean;
	actionError: string | null;
}>;

export const PENDING_EXTENSION_REPOSITORY_ENABLEMENT: ExtensionRepositoryEnablement = Object.freeze(
	{
		enabled: false,
		loading: true,
		error: null,
		changing: false,
		actionError: null,
	},
);

export function extensionRepositoryEnablementKey(
	workstreamId: string,
	extensionId: string,
): string {
	return `${workstreamId}\u0000${extensionId}`;
}

export function extensionEnablementFailureMessage(cause: unknown): string {
	return cause instanceof Error && cause.message ? cause.message : String(cause);
}
