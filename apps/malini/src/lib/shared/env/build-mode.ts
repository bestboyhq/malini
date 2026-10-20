const developmentBuild: boolean = import.meta.env.DEV;

export function isDevelopmentBuild(): boolean {
	return developmentBuild;
}
