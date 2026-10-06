export type ExtensionEventListenerFailure = Readonly<{
	extensionId: string | null;
	error: unknown;
}>;
