export function homePath(path: string, home: string): string {
	if (path === home) return '~';
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
