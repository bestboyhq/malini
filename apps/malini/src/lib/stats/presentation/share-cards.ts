import type { PublishedStats, ShareCard } from '$contract/stats';
import { shiftDate } from '$lib/stats/domain/activity';
import { publishedStreak } from '$lib/stats/domain/published-stats';
import { activityCalendar, type CalendarDay } from './activity-calendar';
import maliniIcon from './malini.webp';

export type ShareCardKind = 'heatmap' | 'readout';

type Palette = Readonly<{
	root: string;
	selected: string;
	border: string;
	tertiary: string;
	secondary: string;
	strong: string;
	blue: string;
	brightBlue: string;
}>;

type Images = Readonly<{ icon: HTMLImageElement; avatar: HTMLImageElement | null }>;

type TextStyle = Readonly<{
	size: number;
	color: string;
	weight?: number;
	mono?: boolean;
	spacing?: number;
	lineHeight?: number;
	align?: CanvasTextAlign;
}>;

const WIDTH = 1200;
const HEIGHT = 630;
const SCALE = 2;
const SANS = '"Geist Variable", system-ui, sans-serif';
const MONO = '"Geist Mono Variable", ui-monospace, Menlo, monospace';
const LEVEL_ALPHA = [0.38, 0.52, 0.72, 1] as const;
const HEATMAP_WEEKS = 10;
const READOUT_DAYS = 21;

const numberFormat = new Intl.NumberFormat('en-US');
const dayFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const rangeFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC',
});

export async function shareCardPng(
	kind: ShareCardKind,
	card: ShareCard,
	stats: PublishedStats,
): Promise<string> {
	await Promise.all([
		document.fonts.load(`600 22px ${SANS}`),
		document.fonts.load(`400 18px ${MONO}`),
	]);
	const images = {
		icon: await loaded(maliniIcon),
		avatar: card.avatar ? await loaded(card.avatar).catch(() => null) : null,
	};
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH * SCALE;
	canvas.height = HEIGHT * SCALE;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('this window cannot draw images');
	const palette = cardPalette();
	context.scale(SCALE, SCALE);
	context.save();
	context.beginPath();
	context.roundRect(0, 0, WIDTH, HEIGHT, 28);
	context.clip();
	context.fillStyle = palette.root;
	context.fillRect(0, 0, WIDTH, HEIGHT);
	if (kind === 'heatmap') drawHeatmapCard(context, palette, images, card, stats);
	else drawReadoutCard(context, palette, images, card, stats);
	context.restore();
	context.globalAlpha = 0.06;
	context.strokeStyle = palette.strong;
	context.lineWidth = 1;
	context.beginPath();
	context.roundRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1, 27.5);
	context.stroke();
	return canvas.toDataURL('image/png');
}

function drawHeatmapCard(
	context: CanvasRenderingContext2D,
	palette: Palette,
	images: Images,
	card: ShareCard,
	stats: PublishedStats,
): void {
	drawAvatar(context, palette, images.avatar, card, 64, 52, 48);
	const name = card.name ?? card.handle ?? '';
	text(context, name, 126, 52, { size: 22, weight: 600, color: palette.strong, lineHeight: 26.4 });
	if (card.handle) {
		text(context, `@${card.handle}`, 126, 78.4, { size: 16, mono: true, color: palette.tertiary });
	}
	drawBrand(context, palette, images.icon, WIDTH - 64, 76, 34, 22);

	const runs = numberFormat.format(stats.totals.runs);
	text(context, runs, 64, 318, {
		size: 132,
		weight: 600,
		spacing: -7.26,
		lineHeight: 118.8,
		color: palette.strong,
	});
	const label = 'agent runs';
	text(context, label, 64, 450.8, { size: 22, color: palette.secondary, lineHeight: 26 });
	const labelWidth = measure(context, label, { size: 22, color: palette.secondary });
	text(context, ` · ${dateRange(stats.since, stats.through)}`, 64 + labelWidth, 450.8, {
		size: 22,
		color: palette.tertiary,
		lineHeight: 26,
	});

	const facts = [
		[stats.intensity.agents.mean.toFixed(1), 'agents at once, avg'],
		[duration(stats.intensity.runSeconds.p50), 'typical run'],
		[`${numberFormat.format(publishedStreak(stats))} days`, 'streak'],
		[numberFormat.format(stats.totals.mergedPullRequests), 'PRs merged'],
	] as const;
	let factX = 64;
	for (const [value, caption] of facts) {
		const valueStyle = { size: 30, weight: 600, spacing: -0.9, color: palette.strong };
		const captionStyle = { size: 15, color: palette.tertiary };
		text(context, value, factX, 520.8, { ...valueStyle, lineHeight: 36 });
		text(context, caption, factX, 556.8, { ...captionStyle, lineHeight: 18 });
		factX +=
			Math.max(measure(context, value, valueStyle), measure(context, caption, captionStyle)) + 36;
	}

	drawHeatmap(context, palette, stats, WIDTH - 64 - 394, 241);
}

function drawHeatmap(
	context: CanvasRenderingContext2D,
	palette: Palette,
	stats: PublishedStats,
	left: number,
	top: number,
): void {
	const caption = { size: 14, color: palette.tertiary, lineHeight: 18 };
	const calendar = activityCalendar(stats.days, stats.through, HEATMAP_WEEKS);
	for (const month of weekMonths(calendar.weeks)) {
		text(context, month.label, left + month.week * 40, top, caption);
	}
	calendar.weeks.forEach((week, column) => {
		week.forEach((day, row) => {
			if (day.future) return;
			context.save();
			context.globalAlpha = day.level === 0 ? 0.1 : (LEVEL_ALPHA[day.level - 1] ?? 1);
			context.fillStyle = day.level === 0 ? palette.strong : palette.blue;
			context.beginPath();
			context.roundRect(left + column * 40, top + 28 + row * 40, 34, 34, 8);
			context.fill();
			context.restore();
		});
	});
	const legendTop = top + 28 + 274 + 14;
	const days = stats.totals.activeDays;
	const legend = { ...caption, lineHeight: 17 };
	text(
		context,
		`${numberFormat.format(days)} active ${days === 1 ? 'day' : 'days'}`,
		left,
		legendTop,
		legend,
	);
	const right = left + 394;
	text(context, 'More', right, legendTop, { ...legend, align: 'right' });
	let swatchX = right - measure(context, 'More', legend) - 5 - 14;
	for (let level = 4; level >= 0; level -= 1) {
		context.save();
		context.globalAlpha = level === 0 ? 1 : (LEVEL_ALPHA[level - 1] ?? 1);
		context.fillStyle = level === 0 ? palette.selected : palette.blue;
		context.beginPath();
		context.roundRect(swatchX, legendTop + 1.5, 14, 14, 4);
		context.fill();
		context.restore();
		swatchX -= 19;
	}
	text(context, 'Less', swatchX + 14, legendTop, { ...legend, align: 'right' });
}

function weekMonths(
	weeks: readonly (readonly CalendarDay[])[],
): readonly Readonly<{ week: number; label: string }>[] {
	const starts: { week: number; label: string }[] = [];
	weeks.forEach((week, index) => {
		const monday = week[0];
		const label = monday ? monthFormat.format(new Date(`${monday.date}T00:00:00Z`)) : null;
		if (label && starts.at(-1)?.label !== label) starts.push({ week: index, label });
	});
	return starts.filter(
		(start, position) => (starts[position + 1]?.week ?? Infinity) - start.week >= 3,
	);
}

function drawReadoutCard(
	context: CanvasRenderingContext2D,
	palette: Palette,
	images: Images,
	card: ShareCard,
	stats: PublishedStats,
): void {
	const prompt = `malini stats --since ${sinceArgument(stats.since, stats.through)}`;
	text(context, '~ ', 64, 48, { size: 18, mono: true, color: palette.tertiary, lineHeight: 22 });
	const tildeWidth = measure(context, '~ ', { size: 18, mono: true, color: palette.tertiary });
	text(context, prompt, 64 + tildeWidth, 48, {
		size: 18,
		mono: true,
		color: palette.secondary,
		lineHeight: 22,
	});
	const promptWidth = measure(context, prompt, { size: 18, mono: true, color: palette.secondary });
	context.fillStyle = palette.blue;
	context.fillRect(64 + tildeWidth + promptWidth + 6, 51, 10, 20);
	const who = [
		card.name && card.name !== card.handle ? card.name : null,
		card.handle && `@${card.handle}`,
	]
		.filter(Boolean)
		.join(' · ');
	text(context, who, WIDTH - 64, 48, {
		size: 18,
		mono: true,
		color: palette.tertiary,
		lineHeight: 22,
		align: 'right',
	});

	const rows = [
		['agent runs', numberFormat.format(stats.totals.runs)],
		['agents at once, average', stats.intensity.agents.mean.toFixed(1)],
		['typical run', duration(stats.intensity.runSeconds.p50)],
		['steps per run, typical', numberFormat.format(stats.intensity.steps.p50)],
		['day streak', numberFormat.format(publishedStreak(stats))],
		['pull requests merged', numberFormat.format(stats.totals.mergedPullRequests)],
	] as const;
	let rowTop = 163.5;
	rows.forEach(([label, value], index) => {
		const lead = index === 0;
		const size = lead ? 30 : 23;
		const lineHeight = lead ? 36 : 27.6;
		const right = 64 + 628;
		const labelStyle = { size, mono: true, color: palette.secondary, lineHeight };
		const valueStyle = {
			size,
			mono: true,
			weight: 500,
			color: lead ? palette.brightBlue : palette.strong,
			lineHeight,
			align: 'right' as const,
		};
		text(context, label, 64, rowTop, labelStyle);
		text(context, value, right, rowTop, valueStyle);
		const from = 64 + measure(context, label, labelStyle) + 10;
		const to = right - measure(context, value, valueStyle) - 10;
		const leader = rowTop + lineHeight / 2 + size * 0.28 - 6;
		context.save();
		context.strokeStyle = palette.border;
		context.lineWidth = 2;
		context.lineCap = 'round';
		context.setLineDash([0, 4]);
		context.beginPath();
		context.moveTo(from + 1, leader);
		context.lineTo(to, leader);
		context.stroke();
		context.restore();
		rowTop += lineHeight + 14;
	});

	drawRunsChart(context, palette, stats, WIDTH - 64 - 380, 139.5);

	context.fillStyle = palette.selected;
	context.fillRect(64, 537, WIDTH - 128, 1);
	drawBrand(context, palette, images.icon, 64, 572, 28, 19, 'left');
	text(context, 'bestboy.dev/malini', WIDTH - 64, 562, {
		size: 17,
		mono: true,
		color: palette.tertiary,
		lineHeight: 20,
		align: 'right',
	});
}

function drawRunsChart(
	context: CanvasRenderingContext2D,
	palette: Palette,
	stats: PublishedStats,
	left: number,
	top: number,
): void {
	const first =
		stats.since > shiftDate(stats.through, 1 - READOUT_DAYS)
			? stats.since
			: shiftDate(stats.through, 1 - READOUT_DAYS);
	const runsByDate = new Map(stats.days.map((day) => [day.date, day.runs]));
	const dates: string[] = [];
	for (let date = first; date <= stats.through; date = shiftDate(date, 1)) dates.push(date);
	const busiest = Math.max(1, ...dates.map((date) => runsByDate.get(date) ?? 0));
	text(context, 'runs per day', left, top, {
		size: 16,
		mono: true,
		color: palette.tertiary,
		lineHeight: 19,
	});
	const barsTop = top + 31;
	const gap = 6;
	const width = (380 - gap * (dates.length - 1)) / dates.length;
	dates.forEach((date, index) => {
		const runs = runsByDate.get(date) ?? 0;
		if (runs === 0) return;
		const height = (runs / busiest) * 230;
		context.save();
		context.globalAlpha = runs === busiest ? 1 : 0.72;
		context.fillStyle = palette.blue;
		context.beginPath();
		context.roundRect(
			left + index * (width + gap),
			barsTop + 230 - height,
			width,
			height,
			[4, 4, 0, 0],
		);
		context.fill();
		context.restore();
	});
	context.fillStyle = palette.border;
	context.fillRect(left, barsTop + 230, 380, 1);
	const axisTop = barsTop + 231 + 12;
	const axisStyle = { size: 15, mono: true, color: palette.tertiary, lineHeight: 18 };
	text(context, dayFormat.format(new Date(`${first}T00:00:00Z`)), left, axisTop, axisStyle);
	text(context, dayFormat.format(new Date(`${stats.through}T00:00:00Z`)), left + 380, axisTop, {
		...axisStyle,
		align: 'right',
	});
}

function drawAvatar(
	context: CanvasRenderingContext2D,
	palette: Palette,
	avatar: HTMLImageElement | null,
	card: ShareCard,
	x: number,
	y: number,
	size: number,
): void {
	context.save();
	context.beginPath();
	context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
	context.clip();
	if (avatar) {
		context.drawImage(avatar, x, y, size, size);
	} else {
		context.fillStyle = palette.selected;
		context.fillRect(x, y, size, size);
		const initial = (card.name ?? card.handle ?? '').charAt(0).toUpperCase();
		text(context, initial, x + size / 2, y, {
			size: size * 0.45,
			weight: 600,
			color: palette.secondary,
			lineHeight: size,
			align: 'center',
		});
	}
	context.restore();
}

function drawBrand(
	context: CanvasRenderingContext2D,
	palette: Palette,
	icon: HTMLImageElement,
	edge: number,
	middle: number,
	iconSize: number,
	fontSize: number,
	from: 'left' | 'right' = 'right',
): void {
	const style = { size: fontSize, weight: 600, spacing: -fontSize * 0.01, color: palette.strong };
	const width = iconSize + 10 + measure(context, 'Malini', style);
	const left = from === 'right' ? edge - width : edge;
	context.save();
	context.beginPath();
	context.roundRect(left, middle - iconSize / 2, iconSize, iconSize, 7);
	context.clip();
	context.drawImage(icon, left, middle - iconSize / 2, iconSize, iconSize);
	context.restore();
	text(context, 'Malini', left + iconSize + 10, middle - (fontSize * 1.2) / 2, {
		...style,
		lineHeight: fontSize * 1.2,
	});
}

function text(
	context: CanvasRenderingContext2D,
	value: string,
	x: number,
	top: number,
	style: TextStyle,
): void {
	if (!value) return;
	applyFont(context, style);
	const metrics = context.measureText(value);
	const ascent = metrics.fontBoundingBoxAscent;
	const contentHeight = ascent + metrics.fontBoundingBoxDescent;
	const lineHeight = style.lineHeight ?? contentHeight;
	context.fillStyle = style.color;
	context.textAlign = style.align ?? 'left';
	context.textBaseline = 'alphabetic';
	context.fillText(value, x, top + (lineHeight - contentHeight) / 2 + ascent);
}

function measure(context: CanvasRenderingContext2D, value: string, style: TextStyle): number {
	applyFont(context, style);
	return context.measureText(value).width;
}

function applyFont(context: CanvasRenderingContext2D, style: TextStyle): void {
	context.font = `${style.weight ?? 400} ${style.size}px ${style.mono ? MONO : SANS}`;
	context.letterSpacing = `${style.spacing ?? 0}px`;
}

function cardPalette(): Palette {
	const style = getComputedStyle(document.documentElement);
	const token = (name: string): string => style.getPropertyValue(name).trim();
	return {
		root: token('--color-grey-950'),
		selected: token('--color-grey-800'),
		border: token('--color-grey-700'),
		tertiary: token('--color-grey-500'),
		secondary: token('--color-grey-400'),
		strong: token('--color-grey-100'),
		blue: token('--ds-blue-700-dark'),
		brightBlue: token('--ds-blue-600-dark'),
	};
}

async function loaded(source: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = source;
	await image.decode();
	return image;
}

function dateRange(since: string, through: string): string {
	return rangeFormat
		.formatRange(new Date(`${since}T00:00:00Z`), new Date(`${through}T00:00:00Z`))
		.replace(/\s*[–—]\s*/u, ' - ');
}

function sinceArgument(since: string, through: string): string {
	const date = new Date(`${since}T00:00:00Z`);
	const day = `${monthFormat.format(date).toLowerCase()}-${date.getUTCDate()}`;
	return since.slice(0, 4) === through.slice(0, 4) ? day : `${day}-${since.slice(0, 4)}`;
}

function duration(seconds: number): string {
	if (seconds < 60) return `${seconds} s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} min`;
	return `${(minutes / 60).toFixed(1)} h`;
}
