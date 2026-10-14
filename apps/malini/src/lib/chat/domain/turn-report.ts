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
	/^\s*(?:[-*]\s+)?(?:\*\*|__)?(outcome|needs|commit|pull request|resolved)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*?)\s*$/iu;
const NOTHING_NEEDED = /^(?:nothing|none|no|n\/a|-|—)\.?$/iu;
const CODE_OR_MARKDOWN_IMAGE =
	/((?:^|\n) {0,3}(`{3,}|~{3,})[\s\S]*?(?:\n {0,3}\2|$)|(`+)[^\n]*?\3)|!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/gu;

export function parseTurnReport(text: string): TurnReport {
	const lines = text.replace(/\r\n?/gu, '\n').split('\n');
	const footer = new Map<FooterKey, string>();
	let bodyEnd = lines.length;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index] ?? '';
		if (line.trim() === '') continue;
		const match = FOOTER_LINE.exec(line);
		const key = match?.[1]?.toLowerCase();
		if (match && key === 'resolved') {
			bodyEnd = index;
			continue;
		}
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
		images: [...body.matchAll(CODE_OR_MARKDOWN_IMAGE)]
			.filter((match) => match[1] === undefined)
			.map((image) => ({ alt: image[4]?.trim() ?? '', src: image[5] ?? '' })),
		details: body
			.replace(CODE_OR_MARKDOWN_IMAGE, (_image, code: string | undefined) => code ?? '')
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
