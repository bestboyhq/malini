import type { ActivityDay, BestboyProjectState } from '$contract/stats';
import { localDate, shiftDate } from './activity';

export const PROJECT_STATES: readonly BestboyProjectState[] = [
	'preview',
	'ready',
	'submitted',
	'live',
	'asked',
	'removed',
];

export const MAX_PROJECTS = 100;

const MAX_LINK_LENGTH = 300;
const PROJECT_DAYS = 371;
const MAX_DAY_RUNS = 3_000;
const MAX_CHANGELOG_BYTES = 32 * 1024;
const NEWLINE = 0x0a;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu;
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/u;
const TOP_LEVEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/u;
const PRIVATE_TOP_LEVELS: ReadonlySet<string> = new Set([
	'local',
	'localhost',
	'internal',
	'lan',
	'home',
	'corp',
	'test',
	'invalid',
	'onion',
]);

export type ProjectLink =
	Readonly<{ link: string; problem: null }> | Readonly<{ link: null; problem: string }>;

export function projectLink(text: string): ProjectLink {
	const trimmed = text.trim();
	if (trimmed === '') return refused('Needs its link');
	const link = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
	const authority = /^https?:\/\/([^/?#]*)/iu.exec(link)?.[1];
	if (authority === undefined || authority === '') return refused('Not a web address');
	if (authority.includes('@')) return refused('Takes no password');
	if (authority.startsWith('[')) return refused('Needs a domain name, not an IP address');
	if (authority.includes(':')) return refused('Takes no port');
	let hostname: string;
	try {
		hostname = new URL(link).hostname;
	} catch {
		return refused('Not a web address');
	}
	if (IPV4.test(hostname)) return refused('Needs a domain name, not an IP address');
	const labels = hostname.split('.');
	const topLevel = labels.at(-1) ?? '';
	if (
		labels.length < 2 ||
		labels.includes('') ||
		!TOP_LEVEL.test(topLevel) ||
		PRIVATE_TOP_LEVELS.has(topLevel)
	) {
		return refused('Needs a public domain name');
	}
	if (link.length > MAX_LINK_LENGTH)
		return refused(`Too long, ${MAX_LINK_LENGTH} characters at most`);
	return { link, problem: null };
}

export function linkAddress(link: string): string {
	const url = new URL(link);
	return `${url.hostname.replace(/^www\./u, '')}${url.pathname.replace(/\/+$/u, '')}`;
}

export function projectDays(startedAt: readonly string[], cutoff: Date): ActivityDay[] {
	const end = cutoff.getTime();
	const first = shiftDate(localDate(cutoff), -PROJECT_DAYS);
	const runs = new Map<string, number>();
	for (const at of startedAt) {
		const started = new Date(at);
		if (started.getTime() >= end) continue;
		const date = localDate(started);
		if (date >= first) runs.set(date, (runs.get(date) ?? 0) + 1);
	}
	return [...runs]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([date, count]) => ({ date, runs: Math.min(count, MAX_DAY_RUNS) }));
}

export function changelogStart(text: string): string | null {
	if (text.trim() === '') return null;
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= MAX_CHANGELOG_BYTES) return text;
	const end = bytes.subarray(0, MAX_CHANGELOG_BYTES).lastIndexOf(NEWLINE);
	return end < 0 ? null : new TextDecoder().decode(bytes.subarray(0, end + 1));
}

export function projectIndexOfField(field: string | null): number | null {
	const index = field === null ? undefined : /^projects\[(\d+)\]/u.exec(field)?.[1];
	return index === undefined ? null : Number(index);
}

function refused(problem: string): ProjectLink {
	return { link: null, problem };
}
