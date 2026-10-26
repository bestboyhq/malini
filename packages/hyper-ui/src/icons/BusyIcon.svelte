<script module lang="ts">
	type Dot = readonly [x: number, y: number, delayMs: number];

	type Wave = {
		durationMs: number;
		easing: (progress: number) => number;
		keyframes: readonly (readonly [at: number, opacity: number])[];
		dots: readonly Dot[];
	};

	const VIEW_BOX = 18;
	const DOT_CENTERS = [4, 9, 14] as const;
	const DOT_RADIUS = 1.4;
	const FRAME_MS = 1000 / 60;
	const STILL_OPACITY = 0.52;

	const FLOW: Wave = {
		durationMs: 1350,
		easing: cubicBezier(0.42, 0, 0.58, 1),
		keyframes: [
			[0, 0.72],
			[0.18, 0.72],
			[0.38, 0.08],
			[0.78, 0.08],
			[1, 0.72],
		],
		dots: DOT_CENTERS.flatMap((y, row) =>
			DOT_CENTERS.map((x, column) => [x, y, (row + column) * 70] as const),
		),
	};

	const ORBIT: Wave = {
		durationMs: 2000,
		easing: cubicBezier(0, 0, 0.58, 1),
		keyframes: [
			[0, 0.8],
			[0.35, 0.24],
			[1, 0.24],
		],
		dots: (
			[
				[4, 4],
				[9, 4],
				[14, 4],
				[14, 9],
				[14, 14],
				[9, 14],
				[4, 14],
				[4, 9],
			] as const
		).map(([x, y], index) => [x, y, index * 250] as const),
	};

	const FLOW_STYLES = waveStyles(FLOW);
	const ORBIT_STYLES = waveStyles(ORBIT);

	function cubicBezier(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
	): (progress: number) => number {
		const curve = (a: number, b: number, t: number): number =>
			3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
		return (progress) => {
			let low = 0;
			let high = 1;
			for (let step = 0; step < 32; step += 1) {
				const middle = (low + high) / 2;
				if (curve(x1, x2, middle) < progress) low = middle;
				else high = middle;
			}
			return curve(y1, y2, (low + high) / 2);
		};
	}

	function opacityAt(wave: Wave, elapsedMs: number): number {
		const at = (elapsedMs % wave.durationMs) / wave.durationMs;
		for (let index = 1; index < wave.keyframes.length; index += 1) {
			const from = wave.keyframes[index - 1];
			const to = wave.keyframes[index];
			if (!from || !to || at > to[0]) continue;
			return from[1] + (to[1] - from[1]) * wave.easing((at - from[0]) / (to[0] - from[0]));
		}
		return wave.keyframes.at(-1)?.[1] ?? 0;
	}

	function waveStyles(wave: Wave): { icon: string; frames: string } {
		const count = Math.round(wave.durationMs / FRAME_MS);
		const opacities = Array.from({ length: count }, (_, frame) =>
			wave.dots.map(([, , delayMs]) =>
				opacityAt(wave, ((frame + 0.5) * wave.durationMs) / count - delayMs + wave.durationMs),
			),
		);
		const brightest = opacities.map((frame) => Math.max(...frame));
		const dimmest = brightest.indexOf(Math.min(...brightest));
		const frames = opacities.map((_, position) => {
			const shown = opacities[(dimmest + position) % count] ?? [];
			return wave.dots.map(([x, y], dot) => circle(x, y + position * VIEW_BOX, shown[dot] ?? 0));
		});
		const still = wave.dots.map(([x, y]) => circle(x, y, STILL_OPACITY));
		return {
			icon: `--busy-still: ${svgUrl(VIEW_BOX, still.join(''))}`,
			frames: [
				`height: ${count * 100}%`,
				`mask-image: ${svgUrl(VIEW_BOX * count, frames.flat().join(''))}`,
				`animation-duration: ${wave.durationMs}ms`,
				`animation-timing-function: steps(${count})`,
			].join('; '),
		};
	}

	function circle(x: number, y: number, opacity: number): string {
		return `<circle cx='${x}' cy='${y}' r='${DOT_RADIUS}' opacity='${opacity.toFixed(2)}'/>`;
	}

	function svgUrl(height: number, content: string): string {
		const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${VIEW_BOX} ${height}' preserveAspectRatio='none'>${content}</svg>`;
		return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
	}
</script>

<script lang="ts">
	import { iconLabel, type IconProps } from './icon-props';

	interface Props extends IconProps {
		background?: boolean;
	}

	let { class: className, size = 16, ariaLabel, background = false }: Props = $props();
	const styles = $derived(background ? ORBIT_STYLES : FLOW_STYLES);
</script>

<span
	class={['workstream-busy', className]}
	style={styles.icon}
	style:width="{size}px"
	style:height="{size}px"
	{...iconLabel(ariaLabel)}
>
	<span class="frames" style={styles.frames}></span>
</span>

<style>
	.workstream-busy {
		display: block;
		flex: none;
		position: relative;
		overflow: clip;
	}

	.frames {
		position: absolute;
		inset: 0 0 auto;
		background-color: currentColor;
		mask-size: 100% 100%;
		animation-name: workstream-busy-frames;
		animation-iteration-count: infinite;
	}

	@keyframes workstream-busy-frames {
		to {
			transform: translateY(-100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.workstream-busy {
			background-color: currentColor;
			mask-image: var(--busy-still);
			mask-size: 100% 100%;
		}

		.frames {
			display: none;
		}
	}
</style>
