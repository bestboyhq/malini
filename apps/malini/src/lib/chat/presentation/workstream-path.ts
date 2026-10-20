const WORKSTREAM_PREFIX_RE = /^.*\/(?:workstreams|worktrees)\/[^/]+\//;
const QUOTED_WORKSTREAM_PATH_RE =
	/(["'])[/~][^"'\n]*\/(?:workstreams|worktrees)\/[^/"'\n]+\/?([^"'\n]*)\1/gu;
const BARE_WORKSTREAM_PATH_RE =
	/(?<=^|[\s=])[/~](?:[^\s"'\\;&|<>()]|\\.)*\/(?:workstreams|worktrees)\/[^/\s"'\\;&|<>()]+\/?((?:[^\s"'\\;&|<>()]|\\.)*)/gu;

export function relativizeWorkstreamPath(absolutePath: string): string {
	if (!absolutePath) {
		return absolutePath;
	}
	const stripped = absolutePath.replace(WORKSTREAM_PREFIX_RE, '');
	return stripped.length > 0 ? stripped : absolutePath;
}

export function relativizeWorkstreamCommand(command: string): string {
	return command
		.replace(QUOTED_WORKSTREAM_PATH_RE, (_, quote: string, rest: string) =>
			rest ? `${quote}${rest}${quote}` : '.',
		)
		.replace(BARE_WORKSTREAM_PATH_RE, (_, rest: string) => rest || '.');
}
