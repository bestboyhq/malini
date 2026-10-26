<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import type { Attachment } from 'svelte/attachments';
	import { BrowserTab } from '@malini/hyper-ui/components/browser-tab';
	import { Button } from '@malini/hyper-ui/components/button';
	import { IconButton } from '@malini/hyper-ui/components/icon-button';
	import { Well } from '@malini/hyper-ui/components/well';
	import { BusyIcon, Icon } from '@malini/hyper-ui/icons';
	import './app-ui/app-ui.api';
	import { Loop } from './loop.svelte';

	const timeline = [
		['prompt', 1500],
		['events', 650],
		['events-done', 350],
		['explain', 2300],
		['approval', 2800],
		['press-allow', 200],
		['allowed', 1000],
		['saved', 350],
		['reply', 1400],
		['done', 2400],
		['jobs', 2000],
		['press-ask', 200],
		['ask', 1400],
		['merged', 1000],
		['activity', 2400],
		['press-run', 200],
		['confirming', 350],
		['running', 1600],
		['then', 2000],
		['overview', 1400],
		['press-auto', 200],
		['auto', 3400],
	] as const;

	type Beat = (typeof timeline)[number][0];
	type Mode = 'off' | 'ask' | 'auto';
	type Token = Readonly<{ word: string; mark?: 'code' | 'strong' }>;
	type Glide = { position: number; velocity: number };

	const beats: readonly Beat[] = timeline.map(([beat]) => beat);
	const at = (beat: Beat): number => beats.indexOf(beat);
	const loop = new Loop(timeline.map(([, ms]) => ms));
	const JOBS = at('jobs');

	const chat = $derived(loop.step < JOBS ? loop.step : loop.step === JOBS ? JOBS - 1 : 0);
	const jobs = $derived(loop.step >= JOBS ? loop.step : loop.step === 0 ? loop.last : JOBS);

	const asking = $derived(chat >= at('approval'));
	const settled = $derived(chat >= at('allowed'));
	const open = $derived(chat < at('done'));
	const waitingForUser = $derived(asking && !settled);

	const mode: Mode = $derived(jobs >= at('auto') ? 'auto' : jobs >= at('ask') ? 'ask' : 'off');
	const pressingMode: Mode | null = $derived(
		jobs === at('press-ask') ? 'ask' : jobs === at('press-auto') ? 'auto' : null,
	);
	const view = $derived(jobs >= at('activity') && jobs < at('overview') ? 'activity' : 'overview');
	const waiting = $derived(jobs >= at('merged') && jobs < at('running'));
	const lastRun = $derived(
		jobs >= at('then') ? 'succeeded' : jobs >= at('running') ? 'running' : null,
	);
	const waitingAt = $derived(
		waiting ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(Date.now()) : '',
	);

	const MODES = [
		{ value: 'off', label: 'Off' },
		{ value: 'ask', label: 'Ask me first' },
		{ value: 'auto', label: 'On its own' },
	] as const;

	const JOB = 'Update CHANGELOG.md';
	const THEN = 'Open draft';
	const UPDATE_DOCS = 'Update docs';
	const UPDATE_DOCS_INSTRUCTIONS =
		"Bring this repository's user-facing docs up to date with the code on its base branch.";
	const WORKSTREAM = 'Rate limit headers';
	const WHEN = 'on pull-requests:ship-changed where merged is set';
	const INSTRUCTIONS =
		'Add a line to CHANGELOG.md for the pull request that merged, under Unreleased, in the style of the lines above it.';
	const approvalDetails = [
		['When', WHEN],
		['Then', THEN],
		['Starts as', 'Off, until you turn it on from the Jobs page'],
	] as const;

	const words = (text: string, mark?: Token['mark']): Token[] =>
		text.split(' ').map((word) => (mark ? { word, mark } : { word }));
	const explanation = [
		...words('pull-requests:ship-changed', 'code'),
		...words('fires whenever a workstream’s shipping state changes, and its'),
		...words('merged', 'code'),
		...words('field is set once its pull request merges. I’ll save a job that updates'),
		...words('CHANGELOG.md', 'code'),
		...words('on it, with'),
		...words(THEN, 'strong'),
		...words('as its Then.'),
	];
	const reply = [
		...words('Saved'),
		...words(JOB, 'strong'),
		...words(
			'with its trigger Off, so it never runs on its own. Turn it on from the Jobs page when you trust it.',
		),
	];

	const SPRING_STIFFNESS = 420;
	const MAX_SUBSTEP_MS = 1000 / 240;
	const EMERGE_FADE_PX = 24;
	const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const snap = (px: number): number => Math.round(px * devicePixelRatio) / devicePixelRatio;

	function stepSpring({ position, velocity }: Glide, target: number, elapsedMs: number): Glide {
		if (elapsedMs >= 1000) return { position: target, velocity: 0 };
		const damping = 2 * Math.sqrt(SPRING_STIFFNESS);
		for (let remaining = Math.min(elapsedMs, 34); remaining > 0; remaining -= MAX_SUBSTEP_MS) {
			const seconds = Math.min(MAX_SUBSTEP_MS, remaining) / 1000;
			velocity += (-SPRING_STIFFNESS * (position - target) - damping * velocity) * seconds;
			position += velocity * seconds;
		}
		return Math.abs(target - position) <= 0.5 && Math.abs(velocity) <= 8
			? { position: target, velocity: 0 }
			: { position, velocity };
	}

	const arrive: Attachment<HTMLElement> = (node) => {
		if (reducedMotion()) return;
		node.animate(
			[
				{ transform: 'translateY(8px)', opacity: '0' },
				{ transform: 'translateY(0)', opacity: '1' },
			],
			{ duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
		);
	};

	const stream: Attachment<HTMLElement> = (paragraph) => {
		let line = -1;
		let lineTop = Number.NEGATIVE_INFINITY;
		let order = 0;
		for (const token of paragraph.querySelectorAll<HTMLElement>('.markdown-stream-token')) {
			if (token.offsetTop > lineTop + 8) {
				line += 1;
				lineTop = token.offsetTop;
				order = 0;
			}
			token.style.animationDelay = `${line * 220 + Math.min(order, 6) * 4}ms`;
			order += 1;
		}
	};

	function collapseAway(node: HTMLElement): TransitionConfig {
		if (reducedMotion()) return { duration: 0 };
		Object.assign(node.style, { position: 'absolute', top: '0', insetInline: '0' });
		return {
			duration: 220,
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; clip-path: inset(0 0 ${u * 100}% 0 round 0.75rem);`,
		};
	}

	const glideRows: Attachment<HTMLElement> = (container) => {
		type Row = {
			element: HTMLElement;
			top: number;
			inFlow: boolean;
			glide: Glide;
			translate: string;
			mask: string;
		};
		let rows: Row[] = [];
		let frame: number | null = null;
		let previousMs: number | null = null;
		let width = container.clientWidth;

		function paint(): void {
			let below: number | null = null;
			for (let index = rows.length - 1; index >= 0; index -= 1) {
				const row = rows[index];
				if (!row) continue;
				const offset = row.glide.position;
				const overlap = row.inFlow && below !== null ? offset - below : 0;
				const translate = Math.abs(offset) < 0.5 ? '' : `0 ${snap(offset)}px`;
				const hidden = Math.ceil(overlap);
				const mask =
					overlap < 0.5
						? ''
						: `linear-gradient(to top, transparent ${hidden}px, black ${hidden + Math.min(EMERGE_FADE_PX, hidden)}px)`;
				if (translate !== row.translate) row.element.style.translate = row.translate = translate;
				if (mask !== row.mask) {
					row.mask = mask;
					row.element.style.setProperty('mask-image', mask);
					row.element.style.setProperty('mask-position', mask && '-1rem -1rem');
					row.element.style.setProperty('mask-size', mask && 'calc(100% + 2rem) calc(100% + 1rem)');
					row.element.style.setProperty('mask-repeat', mask && 'no-repeat');
				}
				if (row.inFlow) below = offset;
			}
		}

		function step(nowMs: number): void {
			frame = null;
			const elapsedMs = previousMs === null ? 0 : nowMs - previousMs;
			previousMs = nowMs;
			let moving = false;
			for (const row of rows) {
				if (row.glide.position === 0 && row.glide.velocity === 0) continue;
				row.glide = stepSpring(row.glide, 0, elapsedMs);
				moving ||= row.glide.position !== 0 || row.glide.velocity !== 0;
			}
			paint();
			if (moving) frame = requestAnimationFrame(step);
			else previousMs = null;
		}

		function measure(): void {
			const animate = container.clientWidth === width && !reducedMotion();
			width = container.clientWidth;
			const known = new Map(rows.map((row) => [row.element, row]));
			let moved = false;
			rows = [...container.children].flatMap((element): Row[] => {
				if (!(element instanceof HTMLElement) || element.hasAttribute('data-prompt-row')) return [];
				const top = element.offsetTop;
				const inFlow = getComputedStyle(element).position !== 'absolute';
				const row = known.get(element);
				known.delete(element);
				if (!row) {
					resizeObserver.observe(element);
					const glide = { position: 0, velocity: 0 };
					return [{ element, top, inFlow, glide, translate: '', mask: '' }];
				}
				const shift = row.top - top;
				row.top = top;
				row.inFlow = inFlow;
				if (animate && Math.abs(shift) >= 0.5) {
					row.glide = { position: row.glide.position + shift, velocity: row.glide.velocity };
					moved = true;
				}
				return [row];
			});
			for (const element of known.keys()) resizeObserver.unobserve(element);
			if (!moved) return;
			paint();
			frame ??= requestAnimationFrame(step);
		}

		const resizeObserver = new ResizeObserver(measure);
		const mutationObserver = new MutationObserver(measure);
		mutationObserver.observe(container, { childList: true, subtree: true });
		measure();
		return () => {
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			if (frame !== null) cancelAnimationFrame(frame);
		};
	};

	const followBottom: Attachment<HTMLElement> = (viewport) => {
		const [first, last] = viewport.children;
		if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return;
		const list: HTMLElement = first;
		const holdSpace: HTMLElement = last;
		let glide: Glide = { position: 0, velocity: 0 };
		let target = 0;
		let frame: number | null = null;
		let previousMs: number | null = null;

		const hold = (px: number): void => {
			holdSpace.style.height = `${Math.max(0, Math.round(px))}px`;
		};

		function step(nowMs: number): void {
			frame = null;
			const elapsedMs = previousMs === null ? 0 : nowMs - previousMs;
			previousMs = nowMs;
			glide = stepSpring(glide, target, elapsedMs);
			viewport.scrollTop = snap(glide.position);
			if (glide.position !== target || glide.velocity !== 0) {
				frame = requestAnimationFrame(step);
				return;
			}
			previousMs = null;
			hold(0);
		}

		function reconcile(): void {
			const natural = Math.max(0, list.offsetHeight - viewport.clientHeight);
			if (natural === target) return;
			target = natural;
			if (reducedMotion()) {
				hold(0);
				glide = { position: target, velocity: 0 };
				viewport.scrollTop = target;
				return;
			}
			hold(glide.position - natural);
			viewport.scrollTop = snap(glide.position);
			frame ??= requestAnimationFrame(step);
		}

		const observer = new ResizeObserver(reconcile);
		observer.observe(list);
		observer.observe(viewport);
		return () => {
			observer.disconnect();
			if (frame !== null) cancelAnimationFrame(frame);
		};
	};

	const durations = timeline.map(([, ms]) => ms);
	let stepStartedAt = $state(0);
	let now = $state(0);
	$effect(() => {
		void loop.step;
		stepStartedAt = performance.now();
	});
	const restartStepClock: Attachment = (node) => {
		const observer = new IntersectionObserver(([entry]) => {
			if (entry?.isIntersecting) stepStartedAt = performance.now();
		});
		observer.observe(node);
		return () => observer.disconnect();
	};
	const clock: Attachment = () => {
		const tick = (): void => {
			now = performance.now();
		};
		tick();
		const interval = setInterval(tick, 100);
		return () => clearInterval(interval);
	};
	const elapsed = $derived.by(() => {
		const intoStep = Math.min(Math.max(0, now - stepStartedAt), durations[chat] ?? 0);
		const total = durations.slice(0, chat).reduce((sum, ms) => sum + ms, 0) + intoStep;
		return `${Math.floor(total / 60_000)}m, ${((total % 60_000) / 1_000).toFixed(1)}s`;
	});

	const JOBS_PAGE_MIN_WIDTH = 612;
	const runClock = $derived.by(() => {
		const intoStep = Math.max(0, now - stepStartedAt);
		return `${Math.floor(intoStep / 1_000)}s`;
	});

	const fitJobsPage: Attachment<HTMLElement> = (page) => {
		const scene = page.parentElement;
		if (!scene) return;
		const fit = (): void => {
			const scale = Math.min(1, scene.clientWidth / JOBS_PAGE_MIN_WIDTH);
			page.style.width = `${scene.clientWidth / scale}px`;
			page.style.height = `${scene.clientHeight / scale}px`;
			page.style.transform = scale === 1 ? '' : `scale(${scale})`;
		};
		const observer = new ResizeObserver(fit);
		observer.observe(scene);
		return () => observer.disconnect();
	};
</script>

{#snippet streamed(tokens: readonly Token[])}
	<div class="markdown-text">
		<p {@attach stream}>
			{#each tokens as token, index (index)}
				{#if token.mark === 'code'}
					<code><span class="markdown-stream-token">{token.word}</span></code>
				{:else if token.mark === 'strong'}
					<strong><span class="markdown-stream-token">{token.word}</span></strong>
				{:else}
					<span class="markdown-stream-token">{token.word}</span>
				{/if}
				{' '}
			{/each}
		</p>
	</div>
{/snippet}

{#snippet toolRow(name: string, state: 'running' | 'waiting' | 'completed', duration: string)}
	<div class="w-full" {@attach arrive}>
		<div class="text-sm">
			<div class="text-fg-tertiary flex min-h-6 items-center gap-2 transition-[color,border-color]">
				<span class="relative h-3.5 w-3.5 shrink-0">
					<span class="absolute inset-0 grid place-items-center">
						<span
							class={['grid place-items-center', state === 'running' && 'live text-fg-secondary']}
						>
							<Icon name="wrench" size={14} class="shrink-0" />
						</span>
					</span>
				</span>
				<span class="min-w-0 flex-1 truncate">
					{state === 'running' ? `Running ${name}` : name}
				</span>
				<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums">
					{state === 'running' ? 'running…' : state === 'waiting' ? 'waiting' : duration}
				</span>
			</div>
		</div>
	</div>
{/snippet}

{#snippet needsApproval()}
	<span class="text-warning-content grid h-4 w-4 place-items-center">
		<Icon name="circle-dot" size={12} />
	</span>
{/snippet}

{#snippet chip(icon: 'pr-merged' | 'pr-draft' | 'play')}
	<span
		class="border-chip-border bg-chip text-fg-secondary grid size-6 shrink-0 place-items-center rounded-md border-[0.5px]"
	>
		<Icon name={icon} size={13} />
	</span>
{/snippet}

{#snippet jobCard(
	name: string,
	when: string,
	icon: 'pr-merged' | 'play',
	instructions: string,
	triggered: boolean,
)}
	<article
		class="border-surface-50-border bg-surface-50 relative flex w-full flex-col rounded-xl border-[0.5px]"
	>
		<div class="relative flex flex-1 flex-col gap-3 px-4 pt-4 pb-3">
			<div class="flex min-w-0 items-center gap-2">
				{@render chip(icon)}
				<span class="text-fg-tertiary min-w-0 truncate text-xs">{when}</span>
			</div>
			<div class="flex flex-col gap-1">
				<h3 class="text-fg-default truncate text-sm font-semibold">{name}</h3>
				<p class="text-fg-secondary line-clamp-2 min-h-10 text-xs leading-5">{instructions}</p>
			</div>
			<div class="flex min-w-0 items-center gap-2">
				{@render chip('pr-draft')}
				<span class="text-fg-tertiary min-w-0 truncate text-xs">Then {THEN}</span>
			</div>
		</div>
		<div
			class="border-surface-50-border relative flex h-11 items-center gap-2 border-t-[0.5px] px-4 text-xs"
		>
			{#if triggered && lastRun === 'succeeded'}
				<span class="text-success-content flex shrink-0 items-center gap-1">
					<Icon name="check" size={12} />
					Done
				</span>
				<span class="text-fg-tertiary min-w-0 flex-1 truncate tabular-nums">just now</span>
			{:else}
				<span class="text-fg-tertiary min-w-0 flex-1 truncate">No runs yet</span>
			{/if}
			{#if triggered}
				<div
					class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
				>
					{#each MODES as option (option.value)}
						<Button
							size="sm"
							variant="ghost"
							active={option.value === mode || option.value === pressingMode}
							class={[option.value === pressingMode && 'scale-[0.975]']}
						>
							{option.label}
						</Button>
					{/each}
				</div>
			{:else}
				<span class="text-fg-tertiary shrink-0">Runs when you run it</span>
			{/if}
		</div>
	</article>
{/snippet}

{#snippet runRow(title: string, state: 'running' | 'succeeded')}
	<div class="flex items-center gap-2 rounded-xl pr-1" {@attach arrive}>
		<span class="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-xl pl-2 text-left text-xs">
			<span
				class={[
					'grid size-4 shrink-0 place-items-center',
					state === 'running' ? 'text-fg-secondary' : 'text-success-content',
				]}
			>
				{#if state === 'running'}
					<BusyIcon size={12} />
				{:else}
					<Icon name="check" size={13} />
				{/if}
			</span>
			<span class="min-w-0 flex-1 truncate">
				<span class="text-fg-default font-medium">{title}</span>
				<span class="text-fg-tertiary">· {WORKSTREAM}</span>
			</span>
		</span>
		<span class="text-fg-tertiary text-2xs pr-1 tabular-nums" {@attach clock}>
			{state === 'running' ? runClock : 'just now'}
		</span>
	</div>
{/snippet}

<div
	class="app-ui relative min-h-0 flex-1 overflow-hidden"
	role="img"
	aria-label="A demo chat: asked to update CHANGELOG.md and open a draft PR whenever a pull request merges, the agent looks up the pull-requests:ship-changed event and asks to save the job Update CHANGELOG.md, with Open draft as its Then. Allowed once, it saves with its trigger Off. On the Jobs page, the job is set to Ask me first, a merge waits for you under Activity and you run it, Open draft runs after it, then the job is set to On its own."
	data-nosnippet
	{@attach loop.play}
	{@attach restartStepClock}
>
	<div class="absolute inset-0" inert>
		<div class="scene absolute inset-0 flex flex-col" class:shown={loop.step < JOBS}>
			<div class="flex h-10 shrink-0 items-center overflow-hidden pl-1">
				<div class="flex min-w-0 flex-1 items-center">
					<div class="relative flex min-w-0 flex-1 items-center gap-px overflow-hidden">
						<BrowserTab
							surface="band"
							label="Rate limit headers"
							selected={false}
							closeLabel="Close Rate limit headers"
							onclose={() => undefined}
						/>
						<BrowserTab
							surface="band"
							label="Changelog job"
							selected
							closeLabel="Close Changelog job"
							onclose={() => undefined}
							busy={open && !waitingForUser}
							trailing={waitingForUser ? needsApproval : undefined}
						/>
						<span class="inline-flex size-7 shrink-0 items-center justify-center">
							<IconButton
								bare
								ariaLabel="Start a fresh chat"
								class="text-fg-tertiary relative grid size-5 place-items-center rounded-sm"
							>
								<Icon name="plus" size={14} />
							</IconButton>
						</span>
					</div>
				</div>
			</div>
			<div class="min-h-0 w-full flex-1 overflow-hidden" {@attach followBottom}>
				<ol class="chat-column flex flex-col gap-8 px-7 pt-2 pb-5 select-none">
					<li class="group/run relative flex flex-col gap-2" {@attach glideRows}>
						<div
							class="sticky-prompt-fade bg-surface-root sticky top-0 z-40 -mx-3 mb-3.5 flex w-[calc(100%+1.5rem)] flex-col items-start gap-1.5"
							data-prompt-row
						>
							<div
								class="prompt-clamp group/prompt bg-surface-50 border-surface-50-border text-fg-default w-full rounded-xl border px-3 py-2.5 text-left text-sm leading-6 select-none"
							>
								<span class="prompt-clamp-body">
									When a pull request merges, update CHANGELOG.md and open a draft PR.
								</span>
							</div>
						</div>

						{#if chat >= at('events')}
							{@render toolRow(
								'Malini · Events List',
								chat >= at('events-done') ? 'completed' : 'running',
								'41ms',
							)}
						{/if}

						{#if chat >= at('explain')}
							<div class="text-fg-default w-full text-sm leading-relaxed" {@attach arrive}>
								{@render streamed(explanation)}
							</div>
						{/if}

						{#if asking}
							{@render toolRow(
								'Malini · Jobs Save',
								chat >= at('saved') ? 'completed' : settled ? 'running' : 'waiting',
								'4.21s',
							)}
							<div class="relative w-full" {@attach arrive}>
								{#if settled}
									<div
										in:fade={{ duration: reducedMotion() ? 0 : 180, delay: 60 }}
										class="text-fg-tertiary flex min-h-6 w-full items-center gap-2 text-sm"
									>
										<span class="grid h-3.5 w-3.5 shrink-0 place-items-center">
											<Icon name="check" size={13} />
										</span>
										<span class="text-fg-secondary shrink-0">Allowed once</span>
										<span class="text-2xs min-w-0 flex-1 truncate font-mono">
											Save job ‘{JOB}’
										</span>
									</div>
								{:else}
									<section
										out:collapseAway
										class="bg-surface-50 border-surface-50-border w-full rounded-xl border px-3.5 py-3"
									>
										<div class="flex items-start gap-2.5">
											<span class="grid h-5 w-4 shrink-0 place-items-center">
												<Icon name="shield-alert" class="text-warning-content" size={15} />
											</span>
											<div class="min-w-0 flex-1">
												<h3 class="text-fg-default text-sm leading-5 font-medium">
													Save job ‘{JOB}’
												</h3>
												<dl
													class="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5"
												>
													{#each approvalDetails as [label, value] (label)}
														<dt class="text-fg-tertiary">{label}</dt>
														<dd
															class="text-fg-secondary max-h-40 overflow-y-auto break-words whitespace-pre-wrap select-text"
														>
															{value}
														</dd>
													{/each}
												</dl>
											</div>
										</div>
										<div class="mt-3 flex flex-wrap items-center justify-end gap-1.5">
											<Button variant="ghost" size="md" class="text-xs">Deny</Button>
											<Button
												variant="primary"
												size="md"
												active={chat === at('press-allow')}
												class={['text-xs', chat === at('press-allow') && 'scale-[0.975]']}
											>
												Allow once
											</Button>
										</div>
									</section>
								{/if}
							</div>
						{/if}

						{#if chat >= at('reply')}
							<div class="text-fg-default w-full text-sm leading-relaxed" {@attach arrive}>
								{@render streamed(reply)}
							</div>
						{/if}

						<div class={['flex min-h-6 items-center', !open && 'sr-only']}>
							{#if open}
								<div
									class="flex min-w-0 flex-1 items-center gap-2 text-xs"
									{@attach arrive}
									{@attach clock}
								>
									{#if waitingForUser}
										<span class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center">
											<Icon name="pause" size={12} />
										</span>
										<span class="text-fg-tertiary min-w-0 truncate">Waiting for you</span>
									{:else}
										<span class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center">
											<BusyIcon size={12} />
										</span>
										<span class="text-fg-tertiary min-w-0 truncate font-mono tabular-nums">
											{elapsed}
										</span>
									{/if}
								</div>
							{/if}
						</div>

						{#if asking}
							<div class="flex h-5 items-center justify-end gap-1.5">
								<div class="mr-auto flex min-w-0 items-center gap-1.5">
									{#if !open}
										<Button
											bare
											class="text-2xs text-fg-tertiary inline-flex h-5 shrink-0 items-center gap-1 rounded px-1"
										>
											<Icon name="branch" size={14} />
											Slice and fork
										</Button>
									{/if}
								</div>
							</div>
						{/if}
					</li>
				</ol>
				<div></div>
			</div>
		</div>

		<div class="scene absolute inset-0 overflow-hidden" class:shown={loop.step >= JOBS}>
			<main class="flex h-full w-full origin-top-left flex-col" {@attach fitJobsPage}>
				<header class="flex shrink-0 items-center gap-4 px-6 pt-3 pb-5">
					<h1 class="text-fg-default text-xl font-semibold tracking-tight">Jobs</h1>
					<nav
						class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
					>
						<Button size="sm" variant="ghost" active={view === 'overview'}>Overview</Button>
						<Button size="sm" variant="ghost" active={view === 'activity'}>
							Activity
							{#snippet trailing()}
								{#if waiting}
									<span
										class="bg-warning text-warning-content text-2xs grid min-w-4 place-items-center rounded-full px-1 tabular-nums"
										in:fade={{ duration: reducedMotion() ? 0 : 180 }}
									>
										1
									</span>
								{/if}
							{/snippet}
						</Button>
						<Button size="sm" variant="ghost">Recipes</Button>
					</nav>
				</header>
				<div class="relative min-h-0 flex-1 overflow-hidden">
					<div class="mx-auto flex w-full max-w-[720px] flex-col gap-1.5 px-4 pb-4">
						{#if view === 'overview'}
							<Well title="Your jobs" note="11">
								<ul class="flex flex-col gap-1.5">
									<li class="flex">
										{@render jobCard(
											JOB,
											'When a pull request merges',
											'pr-merged',
											INSTRUCTIONS,
											true,
										)}
									</li>
									<li class="flex">
										{@render jobCard(
											UPDATE_DOCS,
											'When you run it',
											'play',
											UPDATE_DOCS_INSTRUCTIONS,
											false,
										)}
									</li>
								</ul>
							</Well>
						{:else}
							<Well title="Waiting for you" note={waiting ? '1' : undefined}>
								<div
									class="border-surface-50-border bg-surface-50 divide-surface-50-border divide-y-[0.5px] rounded-xl border-[0.5px]"
								>
									{#if waiting}
										<div class="flex items-center gap-3 px-4 py-3">
											<span
												class="bg-warning text-warning-content grid size-7 shrink-0 place-items-center rounded-md"
											>
												<Icon name="signal" size={14} />
											</span>
											<div class="min-w-0 flex-1">
												<h3 class="text-fg-default truncate text-sm font-medium">
													{JOB} wants to run
												</h3>
												<p class="text-fg-tertiary truncate text-xs">
													<span class="font-mono">pull-requests:ship-changed</span>
													in {WORKSTREAM} · {waitingAt}
												</p>
											</div>
											<Button variant="ghost" size="sm" disabled={jobs === at('confirming')}>
												Skip
											</Button>
											<Button
												variant="primary"
												size="sm"
												loading={jobs === at('confirming')}
												active={jobs === at('press-run')}
												class={[jobs === at('press-run') && 'scale-[0.975]']}
											>
												Run it
											</Button>
										</div>
									{:else}
										<p class="text-fg-tertiary px-4 py-3 text-xs">Nothing waits for you.</p>
									{/if}
								</div>
							</Well>
							{#if lastRun}
								<Well title="Running now" note="1">
									<ul
										class="border-surface-50-border bg-surface-50 flex flex-col rounded-xl border-[0.5px] p-1"
									>
										{#key lastRun}
											<li>{@render runRow(lastRun === 'running' ? JOB : THEN, 'running')}</li>
										{/key}
									</ul>
								</Well>
							{/if}
							{#if lastRun === 'succeeded'}
								<Well title="Today" note="1 run">
									<ul
										class="border-surface-50-border bg-surface-50 flex flex-col rounded-xl border-[0.5px] p-1"
									>
										<li>{@render runRow(JOB, 'succeeded')}</li>
									</ul>
								</Well>
							{/if}
						{/if}
					</div>
				</div>
			</main>
		</div>
	</div>
</div>

<style>
	.scene {
		opacity: 0;
		transition: opacity 200ms ease-in;
	}

	.scene.shown {
		opacity: 1;
		transition: opacity 300ms ease-out 200ms;
	}

	.live {
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

	.markdown-text code {
		padding: 0.1em 0.4em;
		border-radius: 0.375em;
		background: var(--color-surface-100);
		color: var(--color-fg-default);
		font-family: var(--font-mono);
		font-size: 0.85em;
		overflow-wrap: anywhere;
		box-decoration-break: clone;
	}

	.markdown-text strong {
		color: var(--color-fg-agent-message-strong);
		font-weight: 600;
	}

	.markdown-stream-token {
		display: inline-block;
		animation: markdown-token-reveal 190ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes markdown-token-reveal {
		from {
			opacity: 0;
			transform: translateY(0.32em);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scene,
		.scene.shown {
			transition: none;
		}

		.live,
		.markdown-stream-token {
			animation: none;
		}
	}
</style>
