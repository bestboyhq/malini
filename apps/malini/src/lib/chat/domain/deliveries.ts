import type { WorkstreamReport, WorkstreamReportMedia } from '$contract/deliveries';
import { backgroundCommandsPhrase } from './background-work';
import { parseTurnReport, workstreamImagePath, type TurnReport } from './turn-report';
import { variantLabel } from './variant-pick';

export type DeliveryKind = 'prompt' | 'report' | 'decision';

export type DeliveryItem = Readonly<{
	kind: DeliveryKind;
	prompt: string;
	fromWorkstreamId: string | null;
	report: WorkstreamReport | null;
	decisionId: string | null;
	chainId: string | null;
	causeEventId: number | null;
}>;

export type DeliveryBatch = Readonly<{
	prompt: string;
	automated: boolean;
	from: string | null;
	chainId: string | null;
	causeEventId: number | null;
	reports: readonly WorkstreamReport[];
	decisions: readonly string[];
}>;

export const REPORTS_PREAMBLE =
	'Malini woke you: work you started moved on. Answer what your plan covers with workstreams_send, and bring the user only what they must decide.';

export const ASKED_PREAMBLE =
	'Malini woke you: work you asked for moved on. Bring the user only what they must decide.';

const REPORT_BODY_CHARS = 6_000;
const REPORT_TAIL_CHARS = 800;
const REPORT_MEDIA_LIMIT = 6;

export function deliveryBatch(items: readonly DeliveryItem[]): DeliveryBatch {
	const reports = items.filter((item) => item.kind === 'report');
	const decisions = items.filter((item) => item.kind === 'decision');
	const prompts = items.filter((item) => item.kind === 'prompt');
	const sections = [
		...(reports.length > 0 ? [preamble(reports), ...reports.map((item) => item.prompt)] : []),
		...decisions.map((item) => item.prompt),
		...prompts.map((item) => item.prompt),
	];
	return {
		prompt: sections.join('\n\n'),
		automated: reports.length === items.length,
		from: items.find((item) => item.fromWorkstreamId !== null)?.fromWorkstreamId ?? null,
		chainId: decisions.length > 0 ? null : (items.find((item) => item.chainId)?.chainId ?? null),
		causeEventId: items.find((item) => item.causeEventId !== null)?.causeEventId ?? null,
		reports: reports.flatMap((item) => (item.report ? [item.report] : [])),
		decisions: decisions.flatMap((item) => (item.decisionId ? [item.decisionId] : [])),
	};
}

function preamble(reports: readonly DeliveryItem[]): string {
	return reports.some((item) => item.report !== null) ? REPORTS_PREAMBLE : ASKED_PREAMBLE;
}

export function reportMedia(report: TurnReport): WorkstreamReportMedia[] {
	return [
		...report.variants.map((variant) => ({
			src: variant.src,
			label: `Variant ${variantLabel(variant)}`,
		})),
		...(report.comparison
			? [{ src: report.comparison.after.src, label: report.comparison.after.alt || 'After' }]
			: []),
		...report.images.map((image) => ({
			src: image.src,
			label: image.alt || image.src.split('/').pop() || image.src,
		})),
	]
		.filter((media) => workstreamImagePath(media.src) !== null)
		.slice(0, REPORT_MEDIA_LIMIT);
}

export function workstreamReport(
	input: Readonly<{
		workstreamId: string;
		runId: string;
		status: WorkstreamReport['status'];
		outcome: string | null;
		needs: string | null;
		summary: string | null;
		backgroundCommands: readonly string[] | null;
	}>,
): WorkstreamReport {
	return {
		workstreamId: input.workstreamId,
		runId: input.runId,
		status: input.status,
		outcome: input.outcome,
		needs: input.needs,
		media: input.summary === null ? [] : reportMedia(parseTurnReport(input.summary)),
		...(input.backgroundCommands === null ? {} : { backgroundCommands: input.backgroundCommands }),
	};
}

export function reportedTurnEnd(
	report: Pick<WorkstreamReport, 'status' | 'backgroundCommands'>,
): string {
	if (report.backgroundCommands) {
		return `is waiting on ${backgroundCommandsPhrase(report.backgroundCommands)}, and reports again if it continues`;
	}
	return report.status === 'failed' ? 'failed its turn' : 'finished a turn';
}

export function parseWorkstreamReport(value: unknown): WorkstreamReport | null {
	if (!isFields(value)) return null;
	const { workstreamId, runId, status, outcome, needs, media, backgroundCommands } = value;
	if (typeof workstreamId !== 'string' || typeof runId !== 'string') return null;
	return {
		workstreamId,
		runId,
		status: status === 'failed' ? 'failed' : 'succeeded',
		outcome: typeof outcome === 'string' ? outcome : null,
		needs: typeof needs === 'string' ? needs : null,
		media: Array.isArray(media)
			? media.flatMap((item: unknown) =>
					isFields(item) && typeof item['src'] === 'string' && typeof item['label'] === 'string'
						? [{ src: item['src'], label: item['label'] }]
						: [],
				)
			: [],
		...(Array.isArray(backgroundCommands)
			? {
					backgroundCommands: backgroundCommands.filter(
						(command: unknown): command is string => typeof command === 'string',
					),
				}
			: {}),
	};
}

function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function reportForLead(summary: string, checkout: string): string {
	const absolute = summary.replace(
		/(!\[[^\]\n]*\]\(\s*<?)([^)\s>]+)/gu,
		(whole, opening: string, src: string) => {
			const path = workstreamImagePath(src);
			return path === null || path.startsWith('/') ? whole : `${opening}${checkout}/${src}`;
		},
	);
	if (absolute.length <= REPORT_BODY_CHARS) return absolute;
	return `${absolute.slice(0, REPORT_BODY_CHARS - REPORT_TAIL_CHARS)}\n[…]\n${absolute.slice(-REPORT_TAIL_CHARS)}`;
}
