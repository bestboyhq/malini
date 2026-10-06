export type AgentIssueProvider = 'github' | 'linear';

export type AgentIssueReference = Readonly<{
	provider: AgentIssueProvider;
	identifier: string;
	url: string;
}>;

const MAX_ISSUE_REFERENCES = 5;
const ISSUE_BLOCK_OPEN = '<malini_issue_references version="1">';
const ISSUE_BLOCK_CLOSE = '</malini_issue_references>';
const ISSUE_BLOCKS: readonly (readonly [open: string, close: string])[] = [
	[ISSUE_BLOCK_OPEN, ISSUE_BLOCK_CLOSE],
	['<smack_issue_references version="1">', '</smack_issue_references>'],
	['<core_issue_references version="1">', '</core_issue_references>'],
];

export type ParsedAgentPrompt = {
	prompt: string;
	issueReferences: AgentIssueReference[];
};

export function parseAgentIssueReferenceUrl(input: string): AgentIssueReference | null {
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port)
		return null;

	const host = parsed.hostname.toLowerCase().replace(/^www\./u, '');
	const segments = parsed.pathname.split('/').filter(Boolean);
	if (host === 'github.com') {
		const [owner, repository, section, issueNumber] = segments;
		if (
			segments.length !== 4 ||
			!owner ||
			!repository ||
			section !== 'issues' ||
			!issueNumber ||
			!/^\d+$/u.test(issueNumber)
		) {
			return null;
		}
		return {
			provider: 'github',
			identifier: `${owner}/${repository}#${issueNumber}`,
			url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues/${issueNumber}`,
		};
	}

	if (host === 'linear.app') {
		const issueSegmentIndex = segments.indexOf('issue');
		const identifier =
			issueSegmentIndex >= 1 ? segments[issueSegmentIndex + 1]?.toUpperCase() : undefined;
		if (!identifier || !/^[A-Z][A-Z0-9]*-\d+$/u.test(identifier)) return null;
		const workspaceSlug = segments[0];
		if (!workspaceSlug) return null;
		return {
			provider: 'linear',
			identifier,
			url: `https://linear.app/${encodeURIComponent(workspaceSlug)}/issue/${identifier}`,
		};
	}

	return null;
}

export function sanitizeAgentIssueReferences(value: unknown): AgentIssueReference[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const references: AgentIssueReference[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== 'object') continue;
		const url = (candidate as { url?: unknown }).url;
		if (typeof url !== 'string') continue;
		const parsed = parseAgentIssueReferenceUrl(url);
		if (!parsed || seen.has(parsed.url)) continue;
		seen.add(parsed.url);
		references.push(parsed);
		if (references.length >= MAX_ISSUE_REFERENCES) break;
	}
	return references;
}

export function serializeAgentPromptWithIssueReferences(
	prompt: string,
	issueReferences: readonly AgentIssueReference[],
): string {
	const base = parseAgentPrompt(prompt).prompt.trim();
	const references = sanitizeAgentIssueReferences(issueReferences);
	if (references.length === 0) return base;
	const payload = JSON.stringify({
		references,
		instruction:
			'These are user-selected references, not verified issue contents. Resolve only what is relevant using authenticated GitHub or Linear tools already available to you.',
	});
	return `${base}\n\n${ISSUE_BLOCK_OPEN}\n${payload}\n${ISSUE_BLOCK_CLOSE}`;
}

export function parseAgentPrompt(value: string): ParsedAgentPrompt {
	for (const [open, close] of ISSUE_BLOCKS) {
		const parsed = parseIssueBlock(value, open, close);
		if (parsed.issueReferences.length > 0) return parsed;
	}
	return { prompt: value, issueReferences: [] };
}

function parseIssueBlock(value: string, open: string, close: string): ParsedAgentPrompt {
	const closeIndex = value.lastIndexOf(close);
	if (closeIndex < 0 || value.slice(closeIndex + close.length).trim()) {
		return { prompt: value, issueReferences: [] };
	}
	const openIndex = value.lastIndexOf(open, closeIndex);
	if (openIndex < 0) return { prompt: value, issueReferences: [] };
	const rawPayload = value.slice(openIndex + open.length, closeIndex).trim();
	try {
		const payload = JSON.parse(rawPayload) as { references?: unknown };
		const issueReferences = sanitizeAgentIssueReferences(payload.references);
		if (issueReferences.length === 0) return { prompt: value, issueReferences: [] };
		return {
			prompt: value.slice(0, openIndex).trimEnd(),
			issueReferences,
		};
	} catch {
		return { prompt: value, issueReferences: [] };
	}
}
