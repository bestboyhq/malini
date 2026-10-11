export type TurnReportImage = Readonly<{ src: string; alt: string }>;

export type TurnReport = Readonly<{
	outcome: string | null;
	needs: readonly string[];
	commit: string | null;
	pullRequest: string | null;
	images: readonly TurnReportImage[];
	details: string;
}>;

type FooterKey = 'outcome' | 'needs' | 'commit' | 'pull request';

const FOOTER_LINE =
	/^\s*(?:[-*]\s+)?(?:\*\*|__)?(outcome|needs|commit|pull request)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*?)\s*$/iu;
const NOTHING_NEEDED = /^(?:nothing|none|no|n\/a|-|—)\.?$/iu;
const MARKDOWN_IMAGE = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/gu;

export function parseTurnReport(text: string): TurnReport {
	const lines = text.replace(/\r\n?/gu, '\n').split('\n');
	const footer = new Map<FooterKey, string>();
	let bodyEnd = lines.length;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index] ?? '';
		if (line.trim() === '') continue;
		const match = FOOTER_LINE.exec(line);
		const key = match?.[1]?.toLowerCase();
		if (!match || !isFooterKey(key) || footer.has(key)) break;
		footer.set(key, stripEmphasis(match[2] ?? ''));
		bodyEnd = index;
	}
	const body = lines.slice(0, bodyEnd).join('\n');
	return {
		outcome: footer.get('outcome') || null,
		needs: neededActions(footer.get('needs') ?? ''),
		commit: footer.get('commit') || null,
		pullRequest: footer.get('pull request') || null,
		images: [...body.matchAll(MARKDOWN_IMAGE)].map((image) => ({
			alt: image[1]?.trim() ?? '',
			src: image[2] ?? '',
		})),
		details: body
			.replace(MARKDOWN_IMAGE, '')
			.replace(/\n{3,}/gu, '\n\n')
			.trim(),
	};
}

export function hasTurnReport(report: TurnReport): boolean {
	return report.outcome !== null;
}

function neededActions(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed || NOTHING_NEEDED.test(trimmed)) return [];
	return trimmed
		.split(';')
		.map((need) => need.trim())
		.filter(Boolean);
}

function stripEmphasis(value: string): string {
	return value.replace(/^(?:\*\*|__)\s*|\s*(?:\*\*|__)$/gu, '').trim();
}

function isFooterKey(value: string | undefined): value is FooterKey {
	return value === 'outcome' || value === 'needs' || value === 'commit' || value === 'pull request';
}
