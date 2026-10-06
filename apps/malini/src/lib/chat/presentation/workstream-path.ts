const WORKSTREAM_PREFIX_RE = /^.*\/(?:workstreams|worktrees)\/[^/]+\//;

export function relativizeWorkstreamPath(absolutePath: string): string {
	if (!absolutePath) {
		return absolutePath;
	}
	const stripped = absolutePath.replace(WORKSTREAM_PREFIX_RE, '');
	return stripped.length > 0 ? stripped : absolutePath;
}
