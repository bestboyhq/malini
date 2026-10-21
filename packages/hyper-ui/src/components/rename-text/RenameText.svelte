<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ClassValue } from 'svelte/elements';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import SensitiveText from '../sensitive/SensitiveText.svelte';
	import {
		RENAME_BAND_PX,
		RENAME_SEAM_PX,
		RENAME_SWEEP_MS,
		renameSweepFrame,
	} from './rename-sweep';

	interface Props {
		text: string;
		shimmer?: boolean;
		class?: ClassValue;
		textClass?: ClassValue;
		textAttach?: Attachment<HTMLElement> | undefined;
		style?: string | undefined;
		[attr: `data-${string}`]: string | undefined;
	}

	type Rename = Readonly<{
		from: string;
		fromWidth: number;
		toWidth: number;
		fromOverflows: boolean;
		toOverflows: boolean;
	}>;

	let {
		text,
		shimmer = false,
		class: className,
		textClass = 'inline-block align-top',
		textAttach,
		style,
		...rest
	}: Props = $props();

	let box: HTMLElement | undefined = $state();
	let current: HTMLElement | undefined = $state();
	let shown = untrack(() => text);
	let rename = $state.raw<Rename | null>(null);
	const progress = new Tween(1, { duration: RENAME_SWEEP_MS });
	const frame = $derived(
		rename && progress.current < 1
			? renameSweepFrame(progress.current, rename.fromWidth, rename.toWidth)
			: null,
	);

	$effect.pre(() => {
		const next = text;
		untrack(() => {
			const from = shown;
			shown = next;
			if (from === next || !shimmer || prefersReducedMotion.current || !box) return;
			void sweepFrom(box, from);
		});
	});

	async function sweepFrom(element: HTMLElement, from: string): Promise<void> {
		const fromWidth = element.getBoundingClientRect().width;
		const fromOverflows = overflows(element);
		rename = null;
		await tick();
		if (!element.isConnected) return;
		rename = {
			from,
			fromWidth,
			toWidth: element.getBoundingClientRect().width,
			fromOverflows,
			toOverflows: overflows(element),
		};
		void progress.set(0, { duration: 0 });
		void progress.set(1);
	}

	function overflows(element: HTMLElement): boolean {
		return (current?.getBoundingClientRect().width ?? 0) - element.clientWidth > 0.5;
	}

	function overflowAt(sweep: Rename, width: number): number {
		const span = sweep.toWidth - sweep.fromWidth;
		const settled = span === 0 ? 1 : Math.min(Math.max((width - sweep.fromWidth) / span, 0), 1);
		const from = Number(sweep.fromOverflows);
		return from + (Number(sweep.toOverflows) - from) * settled;
	}
</script>

<span
	bind:this={box}
	class={['relative overflow-hidden whitespace-nowrap', className]}
	{style}
	style:width={frame ? `${frame.width}px` : undefined}
	style:--rename-center={frame ? `${frame.center}px` : undefined}
	style:--rename-dim={frame?.dim}
	style:--rename-band={frame ? `${RENAME_BAND_PX}px` : undefined}
	style:--rename-seam={frame ? `${RENAME_SEAM_PX}px` : undefined}
	style:--rename-overflow={frame && rename ? overflowAt(rename, frame.width) : undefined}
	data-renaming={frame ? 'true' : undefined}
	{...rest}
>
	<span class={['rename-current', textClass]} bind:this={current} {@attach textAttach}>
		<SensitiveText {text} />
	</span>
	{#if frame && rename}
		<span class={['rename-previous', textClass]} aria-hidden="true">
			<SensitiveText text={rename.from} interactive={false} />
		</span>
		<span class="rename-glint" aria-hidden="true">
			<span class={['rename-next', textClass]}>
				<SensitiveText {text} interactive={false} />
			</span>
			<span class={['rename-previous', textClass]}>
				<SensitiveText text={rename.from} interactive={false} />
			</span>
		</span>
	{/if}
</span>

<style>
	[data-renaming] > .rename-current,
	[data-renaming] > .rename-previous {
		color: color-mix(in srgb, currentColor calc(100% - var(--rename-dim) * 45%), transparent);
	}

	[data-renaming] > .rename-current,
	.rename-next {
		mask-image: linear-gradient(
			90deg,
			black calc(var(--rename-center) - var(--rename-seam)),
			transparent calc(var(--rename-center) + var(--rename-seam))
		);
	}

	.rename-previous,
	.rename-next {
		position: absolute;
		top: 0;
		right: 0;
		left: 0;
	}

	.rename-previous {
		mask-image: linear-gradient(
			90deg,
			transparent calc(var(--rename-center) - var(--rename-seam)),
			black calc(var(--rename-center) + var(--rename-seam))
		);
	}

	.rename-glint {
		position: absolute;
		inset: 0;
		color: var(--color-fg-default);
		mask-image: linear-gradient(
			90deg,
			transparent calc(var(--rename-center) - var(--rename-band) / 2),
			black var(--rename-center),
			transparent calc(var(--rename-center) + var(--rename-band) / 2)
		);
	}
</style>
