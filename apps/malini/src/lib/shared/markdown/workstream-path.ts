import { forwardSlashed } from '$contract/workstream-images';

const WORKSTREAM_PREFIX_RE = /^.*\/(?:workstreams|worktrees)\/[^/]+\//;
const QUOTED_WORKSTREAM_PATH_RE =
	/(["'])(?:[A-Za-z]:)?[/~\\][^"'\n]*[/\\](?:workstreams|worktrees)[/\\][^/\\"'\n]+[/\\]?([^"'\n]*)\1/gu;
const BARE_WORKSTREAM_PATH_RE =
	/(?<=^|[\s=])(?:[A-Za-z]:)?[/~](?:[^\s"'\\;&|<>()]|\\.)*\/(?:workstreams|worktrees)\/[^/\s"'\\;&|<>()]+\/?((?:[^\s"'\\;&|<>()]|\\.)*)/gu;

export function relativizeWorkstreamPath(absolutePath: string): string {
	const slashed = forwardSlashed(absolutePath);
	const stripped = slashed.replace(WORKSTREAM_PREFIX_RE, '');
	return stripped.length > 0 && stripped !== slashed ? stripped : absolutePath;
}

export function relativizeWorkstreamCommand(command: string): string {
	return command
		.replace(QUOTED_WORKSTREAM_PATH_RE, (_, quote: string, rest: string) =>
			rest ? `${quote}${rest}${quote}` : '.',
		)
		.replace(BARE_WORKSTREAM_PATH_RE, (_, rest: string) => rest || '.');
}

export function canonicalChangedPath(value: string): string {
	const normalized = relativizeWorkstreamPath(value.trim().replaceAll('\\', '/'));
	return normalized
		.replace(/^(?:\.\/)+/u, '')
		.replace(/^\/+/u, '')
		.replace(/\/+$/u, '');
}
