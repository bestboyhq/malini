export type ExtensionRepositorySettingContext = {
	repositoryPath?: string | null | undefined;
	repositoryRootPath?: string | null | undefined;
	repositoryFullName?: string | null | undefined;
};

export function resolveRepositorySettingScopeId(
	context: ExtensionRepositorySettingContext,
): string | null {
	const repositoryFullName = context.repositoryFullName?.trim();
	if (repositoryFullName) return repositoryFullName;
	const repositoryRootPath = context.repositoryRootPath?.trim();
	if (repositoryRootPath) return repositoryRootPath;
	const repositoryPath = context.repositoryPath?.trim();
	return repositoryPath || null;
}
