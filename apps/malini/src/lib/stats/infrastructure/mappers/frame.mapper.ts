import type { FrameScript, RendererFrame } from '$contract/stats';

type RawFrameContext = Readonly<{ timeOrigin: number; focused: boolean; route: string }>;

const MAX_SCRIPTS = 5;

export class FrameMapper {
	static fromRawList(raws: readonly PerformanceEntry[], context: RawFrameContext): RendererFrame[] {
		return raws.map((raw) => this.fromRaw(raw, context));
	}

	static fromRaw(raw: PerformanceEntry, context: RawFrameContext): RendererFrame {
		const layoutStartedAt = numberIn(raw, 'styleAndLayoutStart');
		const scripts = field(raw, 'scripts');
		return {
			kind: 'long-frame',
			startedAt: context.timeOrigin + raw.startTime,
			durationMs: raw.duration,
			focused: context.focused,
			route: context.route,
			layoutMs: layoutStartedAt > 0 ? raw.startTime + raw.duration - layoutStartedAt : 0,
			blockingMs: numberIn(raw, 'blockingDuration'),
			scripts: Array.isArray(scripts) ? slowestScripts(scripts) : [],
		};
	}

	static fromGap(startedAt: number, durationMs: number, context: RawFrameContext): RendererFrame {
		return {
			kind: 'frame-gap',
			startedAt: context.timeOrigin + startedAt,
			durationMs,
			focused: context.focused,
			route: context.route,
			layoutMs: null,
			blockingMs: null,
			scripts: [],
		};
	}
}

function slowestScripts(scripts: readonly unknown[]): FrameScript[] {
	return scripts
		.filter((script): script is object => typeof script === 'object' && script !== null)
		.map((script) => ({
			invoker: textIn(script, 'invoker'),
			source: scriptSource(script),
			durationMs: numberIn(script, 'duration'),
			forcedLayoutMs: numberIn(script, 'forcedStyleAndLayoutDuration'),
		}))
		.sort((left, right) => right.durationMs - left.durationMs)
		.slice(0, MAX_SCRIPTS);
}

function scriptSource(script: object): string {
	const file = textIn(script, 'sourceURL').split(/[?#]/u)[0]?.split('/').pop() ?? '';
	const position = numberIn(script, 'sourceCharPosition');
	const place = file && position >= 0 ? `${file}:${position}` : file;
	return [place, textIn(script, 'sourceFunctionName')].filter(Boolean).join(' ');
}

function field(source: object, key: string): unknown {
	const value: unknown = Reflect.get(source, key);
	return value;
}

function numberIn(source: object, key: string): number {
	const value = field(source, key);
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function textIn(source: object, key: string): string {
	const value = field(source, key);
	return typeof value === 'string' ? value : '';
}
