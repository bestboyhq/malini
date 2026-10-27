export type GithubFailure = 'unreachable' | 'down' | 'rate-limited';

export const GITHUB_STATUS_URL = 'https://www.githubstatus.com';

const NETWORK_FAILURE =
	/could not resolve (?:host|hostname|proxy)|failed to connect to|couldn't connect to server|connection refused|connection timed out|operation timed out|network is unreachable|no route to host|temporary failure in name resolution|can't assign requested address|no such host|i\/o timeout|connection reset by peer|tls handshake timeout|error connecting to|couldn't reach/iu;
const SERVER_ERROR =
	/\b(?:HTTP|status code:?) 5\d\d\b|something went wrong while executing your query|github is down/iu;
const RATE_LIMITED = /rate limit|\b(?:HTTP|status code:?) 429\b/iu;

export function isNetworkFailure(output: string): boolean {
	return NETWORK_FAILURE.test(output);
}

export function githubFailure(output: string): GithubFailure | null {
	if (RATE_LIMITED.test(output)) return 'rate-limited';
	if (SERVER_ERROR.test(output)) return 'down';
	if (isNetworkFailure(output)) return 'unreachable';
	return null;
}
