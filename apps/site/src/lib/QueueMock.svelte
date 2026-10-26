<script lang="ts">
	import { untrack } from 'svelte';
	import { cubicOut, quartOut } from 'svelte/easing';
	import { fade, fly, slide } from 'svelte/transition';
	import { BrowserTab } from '@malini/hyper-ui/components/browser-tab';
	import { Button } from '@malini/hyper-ui/components/button';
	import { IconButton } from '@malini/hyper-ui/components/icon-button';
	import { ShimmerText } from '@malini/hyper-ui/components/shimmer-text';
	import { BusyIcon, ClaudeIcon, Icon } from '@malini/hyper-ui/icons';
	import './app-ui/app-ui.api';
	import { Loop } from './loop.svelte';
	import {
		Arrivals,
		FIRST_RUN,
		STORY,
		TranscriptFollow,
		fitWidth,
		flyOut,
		glideRows,
		keyDelays,
		reducedMotion,
		thinkingTicker,
		tokens,
		type Row,
		type Run,
		type Scene,
	} from './queue-mock/queue-mock.api';

	const FIRST_RUN_ELAPSED_MS = 5200;
	const STILL_RUN_ELAPSED_MS = 2400;
	const PLACEHOLDER = 'Ask Malini to make a change…';
	const fold = { duration: 240, easing: quartOut };
	const CUT_OUT_MIN_WIDTH_PX = 440;

	const loop = new Loop(STORY.map((beat) => beat.ms));
	const firstScene: Scene | undefined = STORY[0]?.scene;
	const scene = $derived(STORY[loop.step]?.scene ?? firstScene);
	const runs = $derived(scene?.runs ?? []);
	const queue = $derived(scene?.queue ?? []);
	const latest = $derived(runs.at(-1));
	const isRunning = $derived(latest?.ended === null);

	const arrivals = new Arrivals();
	const follow = new TranscriptFollow();
	const glide = glideRows(() => arrivals.live);

	let root: HTMLDivElement | undefined = $state();
	let frame: HTMLDivElement | undefined = $state();
	let list: HTMLOListElement | undefined = $state();
	let footerHeight = $state(0);
	let trayHeight = $state(0);
	let now = $state(0);
	let typed = $state(0);
	let ghosts = $state<{ id: number; text: string }[]>([]);
	const starts = new Map<string, number>();
	let shownStep = -1;
	let settling = 0;

	const draft = $derived((scene?.draft ?? '').slice(0, typed));

	$effect.pre(() => {
		const step = loop.step;
		const current = scene;
		untrack(() => {
			const restarted = shownStep === -1 || step < shownStep;
			if (restarted && shownStep !== -1) crossfade();
			if (restarted) {
				arrivals.reset();
				follow.live = false;
				starts.clear();
				ghosts = [];
			}
			shownStep = step;
			typed = 0;
			if (current?.sent && !reducedMotion()) ghosts = [...ghosts, { id: step, text: current.sent }];
			const time = performance.now();
			for (const run of current?.runs ?? []) {
				if (run.ended !== null || starts.has(run.id)) continue;
				const head = reducedMotion()
					? STILL_RUN_ELAPSED_MS
					: run.id === FIRST_RUN
						? FIRST_RUN_ELAPSED_MS
						: 0;
				starts.set(run.id, time - head);
			}
			now = time;
		});
	});

	$effect(() => {
		const step = loop.step;
		untrack(() => {
			if (arrivals.live || step !== shownStep) return;
			follow.jump();
			cancelAnimationFrame(settling);
			settling = requestAnimationFrame(() => {
				settling = requestAnimationFrame(() => {
					arrivals.settle();
					follow.live = true;
				});
			});
		});
	});

	$effect(() => {
		const text = scene?.draft ?? '';
		if (!text) return;
		if (reducedMotion()) {
			typed = text.length;
			return;
		}
		const delays = keyDelays(text);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const press = (index: number): void => {
			timer = setTimeout(() => {
				typed = index + 1;
				if (index + 1 < text.length) press(index + 1);
			}, delays[index] ?? 0);
		};
		press(0);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (reducedMotion()) return;
		const timer = setInterval(() => (now = performance.now()), 100);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const space = footerHeight;
		const overlay = trayHeight;
		untrack(() => follow.spaceBelow(space, overlay));
	});

	function elapsed(run: Run): string {
		const ms = Math.max(0, now - (starts.get(run.id) ?? now));
		const minutes = Math.floor(ms / 60_000);
		return `${minutes}m, ${((ms % 60_000) / 1_000).toFixed(1)}s`;
	}

	function crossfade(): void {
		const source = frame;
		if (!source || !root || reducedMotion()) return;
		const copy = source.cloneNode(true);
		if (!(copy instanceof HTMLElement)) return;
		copy.style.position = 'absolute';
		copy.style.inset = '0';
		copy.style.zIndex = '1';
		copy.style.background = 'var(--color-surface-root)';
		root.append(copy);
		const from = source.querySelector('[data-transcript-viewport]');
		const to = copy.querySelector('[data-transcript-viewport]');
		if (from && to) to.scrollTop = from.scrollTop;
		const fadeOut = copy.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 520,
			easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
		});
		fadeOut.onfinish = () => copy.remove();
	}

	function hasFileChanges(run: Run): boolean {
		return run.rows.some((row) => row.kind === 'tool' && row.added + row.removed > 0);
	}
</script>

{#snippet expandMark(icon: 'brain' | 'note' | 'search' | 'pencil' | 'command', live: boolean)}
	<span class="relative h-3.5 w-3.5 shrink-0" aria-hidden="true">
		<span class="absolute inset-0 grid place-items-center">
			<span class={['grid place-items-center', live && 'breathing text-fg-secondary']}>
				<Icon name={icon} size={icon === 'pencil' ? 13 : 14} class="shrink-0" />
			</span>
		</span>
	</span>
{/snippet}

{#snippet say(run: Run, row: Extract<Row, { kind: 'say' }>, latestRun: boolean)}
	<div
		class="text-fg-default w-full text-sm leading-relaxed"
		{@attach arrivals.row(`${run.id}:${row.key}`, latestRun)}
		data-message-kind="assistant"
	>
		<div class="markdown-text select-text">
			<p>
				{#each tokens(row.text) as token, order (order)}
					{#if token.text.trim() === ''}
						{token.text}
					{:else if token.style === 'code'}
						<code class="stream-token">{token.text}</code>
					{:else if token.style === 'strong'}
						<strong class="stream-token">{token.text}</strong>
					{:else}
						<span class="stream-token">{token.text}</span>
					{/if}
				{/each}
			</p>
		</div>
	</div>
{/snippet}

{#snippet timelineRow(run: Run, row: Row, latestRun: boolean)}
	{#if row.kind === 'thinking'}
		{@const ticker = thinkingTicker(row.text)}
		{@const reveal = ticker.key > 1}
		<details
			class="group/expand text-fg-tertiary w-full text-sm"
			{@attach arrivals.row(`${run.id}:${row.key}`, latestRun)}
			data-message-kind="thinking-live"
		>
			<summary
				class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			>
				{@render expandMark('brain', false)}
				<ShimmerText text="Thinking" class="shrink-0" />
				<span
					class="grid min-w-0 flex-1 overflow-hidden transition-[opacity,visibility] duration-200 group-open/expand:invisible group-open/expand:opacity-0"
				>
					{#key ticker.key}
						<span
							class="text-fg-tertiary/75 truncate [grid-area:1/1]"
							in:fly={{ y: 10, duration: 260, easing: cubicOut }}
							out:fly={{ y: -10, duration: 200, easing: cubicOut }}
						>
							{#each ticker.line.split(' ') as word, index (index)}
								<span
									in:fade|global={{ duration: reveal ? 190 : 0, delay: reveal ? index * 28 : 0 }}
								>
									{index > 0 ? ` ${word}` : word}
								</span>
							{/each}
						</span>
					{/key}
				</span>
			</summary>
		</details>
	{:else if row.kind === 'thought'}
		<details
			class="group/expand text-fg-tertiary w-full text-sm"
			{@attach arrivals.row(`${run.id}:${row.key}`, latestRun)}
			data-message-kind="thinking"
		>
			<summary
				class="hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
			>
				{@render expandMark('brain', false)}
				<span class="shrink-0">Thought for {row.seconds}s</span>
				<span
					class="grid min-w-0 flex-1 overflow-hidden transition-[opacity,visibility] duration-200 group-open/expand:invisible group-open/expand:opacity-0"
				>
					<span class="text-fg-tertiary/75 truncate [grid-area:1/1]">{row.text.trim()}</span>
				</span>
			</summary>
		</details>
	{:else if row.kind === 'tool'}
		<div
			class="w-full"
			{@attach arrivals.row(`${run.id}:${row.key}`, latestRun)}
			data-message-kind="tool"
			data-tool-status={row.running ? 'running' : 'completed'}
		>
			<details class="group/expand text-sm">
				<summary
					class="text-fg-tertiary hover:text-fg-secondary flex min-h-6 cursor-pointer list-none items-center gap-2 transition-[color,border-color]"
				>
					{@render expandMark(row.icon, row.running)}
					<span class="min-w-0 flex-1 truncate">{row.label}</span>
					{#if row.added + row.removed > 0}
						<span class="text-3xs shrink-0 font-mono tabular-nums">
							{#if row.added > 0}<span class="text-success-content">+{row.added}</span>{/if}
							{#if row.removed > 0}<span class={['text-error-content', row.added > 0 && 'ml-1']}>
									−{row.removed}
								</span>{/if}
						</span>
					{/if}
				</summary>
			</details>
		</div>
	{:else if row.kind === 'bash'}
		<div
			class="w-full"
			{@attach arrivals.row(`${run.id}:${row.key}`, latestRun)}
			data-message-kind="bash"
		>
			<div class="w-full text-sm" data-bash-status={row.running ? 'running' : 'completed'}>
				<Button
					bare
					class="group/expand text-fg-tertiary hover:text-fg-secondary flex min-h-6 w-full cursor-pointer items-center gap-2 bg-transparent text-left transition-[color,border-color]"
					ariaLabel={`Expand output for ${row.description}`}
				>
					{@render expandMark('command', row.running)}
					<span class="flex min-w-0 flex-1 items-baseline gap-2">
						<span class="text-fg-secondary min-w-0 truncate">{row.description}</span>
						<span class="text-2xs min-w-0 flex-1 truncate font-mono">{row.command}</span>
					</span>
				</Button>
			</div>
		</div>
	{:else}
		{@render say(run, row, latestRun)}
	{/if}
{/snippet}

{#snippet runFooter(run: Run)}
	<div class="flex h-5 items-center justify-end gap-1.5">
		<div class="mr-auto flex min-w-0 items-center gap-1.5">
			{#if hasFileChanges(run)}
				<Button
					bare
					class="text-2xs text-fg-tertiary hover:text-fg-secondary inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 transition-[color,border-color] disabled:cursor-not-allowed disabled:opacity-40"
					disabled={isRunning}
				>
					<Icon name="undo" size={14} />
					Undo this turn
				</Button>
			{/if}
			<Button
				bare
				class="text-2xs text-fg-tertiary hover:text-fg-secondary inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 transition-[color,border-color] disabled:cursor-not-allowed disabled:opacity-40"
				ariaLabel="Slice and fork"
				disabled={isRunning}
			>
				<Icon name="branch" size={14} />
				Slice and fork
			</Button>
		</div>
		<span class="flex">
			<IconButton
				bare
				class="text-fg-tertiary grid h-5 w-5 place-items-center rounded opacity-0"
				ariaLabel="Copy response"
			>
				<Icon name="copy" size={14} />
			</IconButton>
		</span>
	</div>
{/snippet}

{#snippet promptEditor(text: string, caret: boolean)}
	<div class="prompt-editor-host w-full">
		<div
			class="inline-prompt-editor text-fg-default min-h-18 w-full min-w-0 overflow-x-hidden border-0 bg-transparent p-3 pr-4 text-[15px] leading-6 break-words outline-none"
		>
			<p class="relative">
				{#if text}{text}{:else if caret}<span
						class={[
							'prompt-placeholder text-fg-composer-placeholder-focus pointer-events-none absolute inset-x-0 top-0 text-sm',
							ghosts.length > 0 && 'opacity-0',
						]}
					>
						{PLACEHOLDER}
					</span>{/if}{#if caret}{#key typed}<span
							class="prompt-caret"
							aria-hidden="true"
						></span>{/key}{/if}
			</p>
		</div>
	</div>
{/snippet}

<div
	bind:this={root}
	class="app-ui bg-surface-root text-fg-default relative flex min-h-0 flex-1 flex-col overflow-hidden"
	role="img"
	aria-label="A demo of the Malini chat: while an agent runs, two prompts typed with Enter wait in the queue, a third sent with Command Enter steers the run at once, and when that run ends the first queued prompt starts the next run."
	data-nosnippet
	{@attach loop.play}
	{@attach fitWidth(CUT_OUT_MIN_WIDTH_PX)}
>
	<div bind:this={frame} class="flex min-h-0 flex-1 flex-col select-none" inert>
		<div class="flex h-10 shrink-0 items-center overflow-hidden pl-1">
			<div class="flex min-w-0 flex-1 items-center">
				<div class="relative flex min-w-0 flex-1 items-center gap-px overflow-hidden">
					<BrowserTab
						surface="band"
						label="Rate limit headers"
						selected
						busy={isRunning}
						closeLabel="Close Rate limit headers"
						tooltipPlacement="top"
						onclose={() => undefined}
					/>
					<span class="flex size-7 shrink-0 items-center justify-center">
						<IconButton
							bare
							ariaLabel="Start a fresh chat"
							class="text-fg-tertiary relative grid size-5 cursor-pointer place-items-center rounded-sm outline-none"
						>
							<Icon name="plus" size={14} />
						</IconButton>
					</span>
				</div>
			</div>
		</div>

		<div class="transcript-stage relative min-h-0 flex-1">
			<div class="absolute inset-0 z-0 flex min-h-0 flex-col">
				<div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
					<div
						class="flex h-full w-full flex-col overflow-hidden"
						data-transcript-viewport
						{@attach list ? follow.observe(list) : undefined}
					>
						<div class="chat-stage-inset flex grow flex-col">
							<ol
								bind:this={list}
								class="chat-column flex flex-col gap-8 px-7 pt-2 select-none"
								style:padding-bottom="calc(1.25rem + {footerHeight}px + var(--chat-hold-space, 0px))"
							>
								{#each runs as run, index (run.id)}
									{@const isLastRun = index === runs.length - 1}
									<li
										class={[
											'group/run relative flex flex-col gap-2 transition-opacity',
											!isLastRun && run.ended !== null && 'opacity-90',
										]}
										data-run-id={run.id}
										{@attach isLastRun ? glide : undefined}
									>
										<div
											class="sticky-prompt-fade bg-surface-root sticky top-0 z-40 -mx-3 mb-3.5 flex w-[calc(100%+1.5rem)] flex-col items-start gap-1.5"
											data-prompt-row
											{@attach arrivals.prompt(`${run.id}:prompt`)}
										>
											<div
												class="prompt-clamp group/prompt bg-surface-50 border-surface-50-border text-fg-default w-full rounded-xl border px-3 py-2.5 text-left text-sm leading-6 select-none"
												data-message-kind="user"
											>
												<span class="prompt-clamp-body">{run.prompt}</span>
											</div>
										</div>

										{#each run.rows as row (row.key)}
											{@render timelineRow(run, row, isLastRun)}
										{/each}

										{#if isLastRun && run.ended === null}
											<div class="flex min-h-6 items-center" role="status">
												<div
													class="flex min-w-0 flex-1 items-center gap-2 text-xs"
													{@attach arrivals.row(`${run.id}:status`)}
													data-message-kind="assistant-working"
												>
													<span
														class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center"
														aria-hidden="true"
													>
														<BusyIcon size={12} />
													</span>
													<span
														class="text-fg-tertiary min-w-0 truncate font-mono tabular-nums"
														aria-hidden="true"
													>
														{elapsed(run)}
													</span>
												</div>
											</div>
										{/if}

										{#if run.ended === 'cancelled'}
											<div
												class="border-surface-50-border bg-surface-50 text-2xs text-fg-secondary flex items-center gap-1.5 self-start rounded-md border-[0.5px] px-2.5 py-1 font-medium tabular-nums"
												data-message-kind="terminal"
											>
												<Icon name="circle-slash" size={12} class="shrink-0" />
												<span class="tracking-wide uppercase">Run cancelled</span>
											</div>
										{/if}

										{#if run.ended !== null}
											{@render runFooter(run)}
										{/if}
									</li>
								{/each}
							</ol>
						</div>
					</div>
				</div>
			</div>

			<div
				class="chat-footer-scrim absolute inset-x-0 bottom-0 z-20"
				bind:clientHeight={footerHeight}
			>
				<div class="chat-stage-inset flex flex-col">
					<div bind:clientHeight={trayHeight}>
						{#if scene?.changes || queue.length > 0}
							<div class="chat-column px-7" transition:slide={fold}>
								<div
									class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] overflow-hidden rounded-t-xl border-x-[0.5px] border-t-[0.5px]"
								>
									{#if scene?.changes}
										{@const changes = scene.changes}
										<div transition:slide={fold}>
											<section aria-label="Files changed in this chat">
												<Button
													bare
													class="text-fg-secondary hover:bg-surface-50-hover hover:text-fg-default flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left text-xs transition-[color,border-color] outline-none"
													ariaExpanded={false}
												>
													<span class="grid w-4 shrink-0 place-items-center" aria-hidden="true">
														<Icon name="chevron-right" size={12} class="-rotate-90" />
													</span>
													<span class="min-w-0 flex-1 truncate">
														{changes.files}
														{changes.files === 1 ? 'file' : 'files'} changed in this chat
													</span>
													<span class="text-2xs shrink-0 font-mono tabular-nums">
														<span class="text-success-content">+{changes.added}</span>
														<span class="text-error-content ml-1.5">−{changes.removed}</span>
													</span>
												</Button>
											</section>
										</div>
									{/if}
									{#if queue.length > 0}
										<div transition:slide={fold}>
											<section aria-label={`Queued prompts (${queue.length})`}>
												<header class="text-fg-secondary flex h-8 items-center gap-2 px-3 text-xs">
													<span
														class="text-fg-tertiary grid w-4 shrink-0 place-items-center"
														aria-hidden="true"
													>
														<Icon name="clock" size={12} />
													</span>
													<span class="min-w-0 flex-1 truncate">
														{queue.length} queued {queue.length === 1 ? 'prompt' : 'prompts'}
													</span>
													{#if queue.length > 1}
														<span class="text-2xs text-fg-tertiary shrink-0">Runs in order</span>
													{/if}
												</header>
												<ul class="max-h-48 overflow-y-auto px-1 pb-1">
													{#each queue as item, index (item)}
														<li class="hover:bg-surface-50-hover rounded-lg px-2 py-1">
															<div class="flex min-w-0 items-center gap-2">
																<span
																	class="text-2xs text-fg-tertiary w-4 shrink-0 text-center tabular-nums"
																>
																	{index + 1}
																</span>
																<p
																	class="text-fg-secondary min-w-0 flex-1 truncate text-xs leading-6"
																>
																	{item}
																</p>
																<div class="flex shrink-0 items-center">
																	<span class="flex">
																		<IconButton
																			variant="ghost"
																			size="sm"
																			class="text-fg-tertiary"
																			ariaLabel={`Edit queued prompt ${index + 1}`}
																		>
																			<Icon name="pencil" size={14} />
																		</IconButton>
																	</span>
																	<span class="flex">
																		<IconButton
																			variant="ghost"
																			size="sm"
																			class="text-fg-tertiary"
																			ariaLabel={`Delete queued prompt ${index + 1}`}
																		>
																			<Icon name="trash" size={14} />
																		</IconButton>
																	</span>
																	<span class="flex">
																		<IconButton
																			variant="ghost"
																			size="sm"
																			class="text-fg-tertiary"
																			ariaLabel={`Interrupt and send queued prompt ${index + 1}`}
																		>
																			<Icon name="arrow-up" size={14} />
																		</IconButton>
																	</span>
																</div>
															</div>
														</li>
													{/each}
												</ul>
											</section>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<div>
						<form class="chat-column relative z-20 shrink-0 px-4 pb-1">
							<div
								class="group/composer bg-surface-composer border-surface-150-border @container/composer overflow-hidden rounded-xl border transition-[border-color] duration-150"
								data-composer-mode="agent"
							>
								<div class="relative overflow-hidden">
									{@render promptEditor(draft, true)}
									{#each ghosts as ghost (ghost.id)}
										<div
											class="pointer-events-none absolute top-0 left-0 w-full select-none"
											aria-hidden="true"
											{@attach flyOut(() => (ghosts = ghosts.filter(({ id }) => id !== ghost.id)))}
										>
											{@render promptEditor(ghost.text, false)}
										</div>
									{/each}
								</div>
								<div class="flex h-11 flex-nowrap items-center justify-between gap-3 px-3 pb-2">
									<div class="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
										<span class="flex">
											<IconButton
												variant="ghost"
												size="md"
												ariaLabel="Add to prompt"
												class="text-fg-tertiary hover:bg-surface-50 rounded-lg"
											>
												<Icon name="plus" size={16} />
											</IconButton>
										</span>
										<div class="flex min-w-0">
											<Button
												variant="ghost"
												size="auto"
												ariaLabel="Model: Opus"
												class="text-fg-secondary hover:bg-surface-50 h-7 max-w-40 min-w-0 gap-1.5 rounded-md px-2 text-xs font-normal"
											>
												<ClaudeIcon class="text-fg-secondary shrink-0" size={13} />
												<span class="truncate">Opus</span>
												<Icon name="chevron-down" class="shrink-0" size={12} />
											</Button>
										</div>
										<div class="flex shrink-0 items-center gap-0.5">
											<div>
												<span class="flex">
													<Button
														variant="ghost"
														size="auto"
														class="text-fg-tertiary hover:bg-surface-50 h-7 gap-1.5 rounded-md px-2 text-xs font-normal"
														ariaLabel="Reasoning effort"
													>
														<Icon name="signal" size={15} />
														<span>Medium</span>
													</Button>
												</span>
											</div>
											<span class="flex">
												<IconButton
													variant="ghost"
													size="md"
													ariaLabel="Run options"
													class="text-fg-tertiary hover:bg-surface-50 rounded-lg"
												>
													<Icon name="settings" size={15} />
												</IconButton>
											</span>
										</div>
									</div>
									<div class="flex shrink-0 items-center gap-1">
										<div class="flex items-center gap-0.5">
											<span class="flex">
												<IconButton
													variant="ghost"
													size="md"
													ariaLabel="Context usage"
													class="text-fg-tertiary"
												>
													<svg
														width="16"
														height="16"
														viewBox="0 0 16 16"
														aria-hidden="true"
														class="text-fg-tertiary shrink-0 -rotate-90"
													>
														<circle
															cx="8"
															cy="8"
															r="5.75"
															fill="none"
															stroke="currentColor"
															stroke-width="2"
															class="opacity-25"
														/>
													</svg>
												</IconButton>
											</span>
											<span class="flex">
												<IconButton
													variant="ghost"
													size="md"
													ariaLabel="View MCP server status"
													class="text-fg-tertiary relative"
												>
													<Icon name="plug" size={15} />
												</IconButton>
											</span>
										</div>
										<span class="flex">
											{#if isRunning && !draft}
												<IconButton
													variant="secondary"
													size="md"
													class={['active:scale-95', 'bg-surface-50 hover:bg-error/10']}
													ariaLabel="Stop current run"
												>
													<Icon name="stop" size={12} class="text-error-content" />
												</IconButton>
											{:else}
												<IconButton
													variant="primary"
													size="md"
													type="submit"
													disabled={!draft}
													class="active:scale-95"
													ariaLabel={isRunning ? 'Queue prompt' : 'Send prompt'}
												>
													<Icon name="arrow-up" size={16} />
												</IconButton>
											{/if}
										</span>
									</div>
								</div>
							</div>
							<div class="flex h-6 justify-end px-3">
								{#if scene?.usage}
									<p class="text-2xs flex h-6 items-center gap-1.5 tabular-nums select-none">
										<span class="text-fg-tertiary">Last run</span>
										<span class="text-fg-tertiary/60" aria-hidden="true">·</span>
										<span class="text-fg-tertiary">18,420 input · 1,260 output</span>
									</p>
								{/if}
							</div>
						</form>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.transcript-stage {
		container-type: inline-size;
	}

	.chat-footer-scrim::before {
		position: absolute;
		bottom: 100%;
		right: 0;
		left: 0;
		height: 1.5rem;
		content: '';
		pointer-events: none;
		background: linear-gradient(to bottom, transparent, var(--color-surface-root));
	}

	.chat-footer-scrim::after {
		position: absolute;
		z-index: -1;
		inset: 0;
		content: '';
		pointer-events: none;
		background-color: var(--color-surface-root);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.breathing {
		animation: breathe 1.6s ease-in-out infinite;
	}

	@keyframes breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	.markdown-text {
		font-size: inherit;
		line-height: inherit;
		color: inherit;
	}

	.markdown-text p {
		margin: 0;
		white-space: pre-wrap;
	}

	.markdown-text strong {
		color: var(--color-fg-agent-message-strong);
		font-weight: 600;
	}

	.markdown-text code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		padding: 0.1em 0.4em;
		border-radius: 0.375em;
		background: var(--color-surface-100);
		color: var(--color-fg-default);
		overflow-wrap: anywhere;
		box-decoration-break: clone;
	}

	:global([data-stream]) .stream-token {
		display: inline-block;
		animation: token-reveal 190ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes token-reveal {
		from {
			opacity: 0;
			transform: translateY(0.32em);
		}
	}

	.inline-prompt-editor {
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.prompt-placeholder {
		font-weight: var(--font-weight-normal);
		transition: opacity var(--default-transition-duration);
	}

	.prompt-caret {
		display: inline-block;
		width: 1px;
		height: 1.2em;
		margin-right: -1px;
		vertical-align: -0.25em;
		background: currentColor;
		animation: caret-blink 1.06s steps(1) 0.53s infinite;
	}

	@keyframes caret-blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.breathing,
		:global([data-stream]) .stream-token,
		.prompt-caret {
			animation: none;
		}
	}
</style>
