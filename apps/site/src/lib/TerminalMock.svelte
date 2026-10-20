<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	type Props = { llms: string[]; doc: { path: string; lines: string[] } };
	type Run = { command: string; output: string[] };
	type Frame = { done: number; typed: number; running: boolean; delay: number };

	let { llms, doc }: Props = $props();

	const MARKDOWN_URL = /https[^)]*\.md/g;
	const HEAD = 6;
	const FINAL = Number.POSITIVE_INFINITY;

	const runs: Run[] = $derived([
		{
			command: "curl -s bestboy.dev/malini/llms.txt | grep -o 'https[^)]*\\.md'",
			output: llms.flatMap((line) => line.match(MARKDOWN_URL) ?? []),
		},
		{
			command: `curl -s bestboy.dev/malini${doc.path}.md | head -n ${HEAD}`,
			output: doc.lines.slice(0, HEAD),
		},
	]);

	const frames: Frame[] = $derived([
		...runs.flatMap(({ command }, done) => [
			...Array.from({ length: command.length + 1 }, (_, typed) => ({
				done,
				typed,
				running: false,
				delay: keystroke(done, typed, command.length),
			})),
			{ done, typed: command.length, running: true, delay: 260 },
		]),
		{ done: runs.length, typed: 0, running: false, delay: 0 },
	]);

	let step = $state(FINAL);
	const frame = $derived(frames[Math.min(step, frames.length - 1)]);
	const current = $derived(frame && runs[frame.done]);

	function keystroke(done: number, typed: number, length: number): number {
		if (typed === 0) return done === 0 ? 700 : 1100;
		if (typed === length) return 450;
		return 36 + ((typed * 37) % 7) * 6;
	}

	const play: Attachment<HTMLElement> = (node) => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let armed = false;
		const advance = () => {
			const delay = frames[step]?.delay;
			if (delay === undefined || step >= frames.length - 1) return;
			timer = setTimeout(() => {
				step += 1;
				advance();
			}, delay);
		};
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry) return;
				if (!armed) {
					armed = true;
					if (entry.isIntersecting) observer.disconnect();
					else step = 0;
					return;
				}
				if (entry.intersectionRatio < 0.6) return;
				observer.disconnect();
				advance();
			},
			{ threshold: 0.6 },
		);
		observer.observe(node);
		return () => {
			observer.disconnect();
			clearTimeout(timer);
		};
	};
</script>

<div
	class="terminal"
	role="img"
	aria-label="A terminal listing the markdown URL of every docs page from bestboy.dev/malini/llms.txt, then printing the start of the Routines page as markdown."
	data-nosnippet
	{@attach play}
>
	<div class="screen">
		{#each runs.slice(0, frame?.done ?? 0) as run (run.command)}
			<p class="command">
				<span class="prompt">~</span>
				{run.command}
			</p>
			{#each run.output as line, index (index)}
				<p>{line}</p>
			{/each}
		{/each}
		{#if frame && current}
			<p class="command">
				<span class="prompt">~</span>
				{current.command.slice(0, frame.typed)}{#if !frame.running}<span
						class={['caret', { blink: frame.typed === 0 }]}
					></span>{/if}
			</p>
			{#if frame.running}
				<p><span class="caret"></span></p>
			{/if}
		{:else}
			<p class="command">
				<span class="prompt">~</span>
				<span class="caret blink"></span>
			</p>
		{/if}
	</div>
</div>

<style>
	.terminal {
		height: 100%;
		padding: 18px 20px;
		overflow: hidden;
		background: var(--app-root);
		color: var(--app-fg-2);
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.5;
	}

	.screen {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		height: 100%;
		height: round(down, 100%, 1lh);
		overflow: hidden;
	}

	.screen::after {
		content: '';
		flex: 1 0 0;
	}

	p {
		flex: none;
		min-height: 1lh;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.command {
		color: var(--app-fg);
	}

	.prompt {
		color: var(--app-success);
	}

	.caret {
		display: inline-block;
		width: 1ch;
		height: 1.3em;
		vertical-align: -0.3em;
		background: var(--app-fg-2);
	}

	.blink {
		animation: blink 1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.blink {
			animation: none;
		}
	}
</style>
