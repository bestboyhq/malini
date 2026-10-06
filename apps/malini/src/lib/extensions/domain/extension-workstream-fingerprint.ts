export type ExtensionWorkstreamIdentity = Readonly<{
	id: string;
	path: string;
	repositoryPath: string;
	repositoryRootPath?: string;
	repositoryFullName?: string;
	branch: string;
	baseBranch: string;
}>;

export function extensionWorkstreamFingerprint(value: ExtensionWorkstreamIdentity): string {
	return [
		value.id,
		value.path,
		value.repositoryPath,
		value.repositoryRootPath ?? '',
		value.repositoryFullName ?? '',
		value.branch,
		value.baseBranch,
	].join(' ');
}
