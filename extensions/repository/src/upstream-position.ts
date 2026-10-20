export type UpstreamPosition = Readonly<{
	ahead: number;
	behind: number;
}>;

export function upstreamPositionGlyphs(position: UpstreamPosition): string {
	return join(
		[
			position.ahead > 0 ? `↑${position.ahead}` : '',
			position.behind > 0 ? `↓${position.behind}` : '',
		],
		' ',
	);
}

export function upstreamPositionSummary(position: UpstreamPosition): string {
	return join([
		position.ahead > 0 ? `${position.ahead} unpushed` : '',
		position.behind > 0 ? `${position.behind} behind` : '',
	]);
}

export function unpushedCommits(position: UpstreamPosition): string {
	return `${position.ahead} ${commits(position.ahead)}`;
}

export function unpulledCommits(position: UpstreamPosition): string {
	return `${position.behind} ${commits(position.behind)}`;
}

export function upstreamPositionSentence(position: UpstreamPosition): string {
	if (position.ahead <= 0 && position.behind <= 0) {
		return 'Up to date with the upstream branch';
	}
	return join([
		position.ahead > 0 ? `${position.ahead} ${commits(position.ahead)} ahead` : '',
		position.behind > 0 ? `${position.behind} ${commits(position.behind)} behind` : '',
	]);
}

function commits(count: number): string {
	return count === 1 ? 'commit' : 'commits';
}

function join(parts: readonly string[], separator = ' · '): string {
	return parts.filter(Boolean).join(separator);
}
