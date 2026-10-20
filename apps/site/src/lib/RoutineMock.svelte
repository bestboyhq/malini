<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import type { Attachment } from 'svelte/attachments';
	import { Badge } from '@malini/hyper-ui/components/badge';
	import { BrowserTab } from '@malini/hyper-ui/components/browser-tab';
	import { Button } from '@malini/hyper-ui/components/button';
	import { IconButton } from '@malini/hyper-ui/components/icon-button';
	import { Select } from '@malini/hyper-ui/components/select';
	import { TextInput } from '@malini/hyper-ui/components/text-input';
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
		['jobs', 2200],
		['press-candidate', 200],
		['promoting-candidate', 350],
		['candidate', 1600],
		['held', 2600],
		['press-confirm', 200],
		['confirming', 350],
		['confirmed', 1400],
		['press-routine', 200],
		['promoting-routine', 350],
		['routine', 3400],
	] as const;

	type Beat = (typeof timeline)[number][0];
	type Status = 'draft' | 'candidate' | 'routine';
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

	const status: Status = $derived(
		jobs >= at('routine') ? 'routine' : jobs >= at('candidate') ? 'candidate' : 'draft',
	);
	const pressingPromote = $derived(jobs === at('press-candidate') || jobs === at('press-routine'));
	const held = $derived(jobs >= at('held') && jobs < at('confirmed'));
	const heldAt = $derived(
		held
			? new Intl.DateTimeFormat(undefined, {
					month: 'short',
					day: 'numeric',
					hour: 'numeric',
					minute: '2-digit',
				}).format(Date.now())
			: '',
	);
	const promoting = $derived(
		jobs === at('promoting-candidate') || jobs === at('promoting-routine'),
	);
	const promoteLabel = $derived(
		status === 'draft'
			? 'Promote to candidate'
			: status === 'candidate'
				? 'Promote to routine'
				: null,
	);
	const demoteLabel = $derived(
		status === 'routine'
			? 'Demote to candidate'
			: status === 'candidate'
				? 'Demote to draft'
				: null,
	);

	const groups = [
		{
			status: 'draft',
			heading: 'Drafts',
			description: 'Never triggered. Run one by hand to try it, then promote it.',
			empty: 'No drafts. Author one below, or accept a suggestion.',
		},
		{
			status: 'candidate',
			heading: 'Candidates',
			description: 'When the trigger fires, the run waits for your confirmation.',
			empty: 'No candidates.',
		},
		{
			status: 'routine',
			heading: 'Routines',
			description: 'Trusted; these run unattended when their trigger fires.',
			empty: 'No routines yet.',
		},
	] as const;

	const ROUTINE = 'Docs after merge';
	const WHEN = 'on pull-requests:ship-changed where merged is set';
	const approvalDetails = [
		['When', WHEN],
		['Runs', 'Update docs'],
		['Starts as', 'A draft you promote on the Jobs page'],
	] as const;

	const words = (text: string, mark?: Token['mark']): Token[] =>
		text.split(' ').map((word) => (mark ? { word, mark } : { word }));
	const explanation = [
		...words('pull-requests:ship-changed', 'code'),
		...words('fires whenever a workstream’s shipping state changes, and its'),
		...words('merged', 'code'),
		...words('field is set once its pull request merges. I’ll save a routine that runs'),
		...words('Update docs', 'strong'),
		...words('on it.'),
	];
	const reply = [
		...words('Saved'),
		...words(ROUTINE, 'strong'),
		...words(
			'as a draft. It never runs on its own: try it with Run now on the Jobs page, then promote it when you trust it.',
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
	let routinesViewport: HTMLElement | undefined = $state();
	let thumb = $state({ top: 0, height: 0, shown: false });
	let thumbTimer: ReturnType<typeof setTimeout> | undefined;

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

	$effect(() => {
		const viewport = routinesViewport;
		if (!viewport) return;
		if (status === 'draft') {
			viewport.scrollTop = 0;
			return;
		}
		void held;
		const timer = setTimeout(() => {
			const row = viewport.querySelector<HTMLElement>('[data-routine-row]');
			if (!row) return;
			const hidden = row.offsetTop + row.offsetHeight + 24 - viewport.clientHeight;
			viewport.scrollTop = Math.max(viewport.scrollTop, hidden);
		}, 400);
		return () => clearTimeout(timer);
	});

	function showThumb(event: Event): void {
		const viewport = event.currentTarget;
		if (!(viewport instanceof HTMLElement)) return;
		const range = viewport.scrollHeight - viewport.clientHeight;
		if (range <= 0) return;
		const height = Math.max(
			36,
			(viewport.clientHeight / viewport.scrollHeight) * viewport.clientHeight,
		);
		thumb = {
			top: (viewport.scrollTop / range) * (viewport.clientHeight - height),
			height,
			shown: true,
		};
		clearTimeout(thumbTimer);
		thumbTimer = setTimeout(() => (thumb.shown = false), 900);
	}
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

{#snippet routineRow()}
	<li
		class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
		data-routine-row
	>
		<div class="flex items-start gap-3">
			<div class="min-w-0 flex-1">
				<div class="flex min-w-0 items-center gap-2">
					<span class="text-fg-default truncate text-sm font-medium">{ROUTINE}</span>
					<Badge>{status}</Badge>
				</div>
				<p class="text-fg-tertiary mt-0.5 truncate text-xs">{WHEN}</p>
				<ol class="mt-1.5 space-y-0.5">
					<li class="text-fg-secondary truncate text-xs">
						<span class="text-fg-tertiary tabular-nums">1.</span>
						Job
						<span class="text-fg-tertiary">·</span>
						<span>Update docs</span>
					</li>
				</ol>
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				<Button variant="ghost" size="2xs" disabled={promoting}>Edit</Button>
				{#if promoteLabel}
					<Button
						variant="secondary"
						size="2xs"
						loading={promoting}
						active={pressingPromote}
						class={[pressingPromote && 'scale-[0.975]']}
					>
						{promoteLabel}
					</Button>
				{/if}
				{#if demoteLabel}
					<Button variant="ghost" size="2xs" disabled={promoting}>{demoteLabel}</Button>
				{/if}
				<Button variant="ghost" size="2xs" disabled={promoting}>Delete</Button>
			</div>
		</div>
		<div class="mt-3 flex items-center gap-2">
			<Select
				value="rate-limit-headers"
				options={[{ value: 'rate-limit-headers', label: 'Rate limit headers' }]}
				class="w-56 min-w-0"
			/>
			<Button variant="secondary" size="sm">
				{#snippet leading()}
					<Icon name="play" size={12} />
				{/snippet}
				Run now
			</Button>
		</div>
		{#if held}
			<ul class="border-surface-100-border mt-2 space-y-1.5 border-t pt-2">
				<li>
					<div class="flex items-center gap-3">
						<div class="min-w-0 flex-1">
							<p class="text-fg-secondary truncate text-xs">
								Held: <span class="font-mono">pull-requests:ship-changed</span>
								<span class="text-fg-tertiary">in Rate limit headers</span>
							</p>
							<p class="text-fg-tertiary text-xs">{heldAt}</p>
						</div>
						<div class="flex shrink-0 items-center gap-1.5">
							<Button
								variant="secondary"
								size="2xs"
								loading={jobs === at('confirming')}
								active={jobs === at('press-confirm')}
								class={[jobs === at('press-confirm') && 'scale-[0.975]']}
							>
								Confirm
							</Button>
							<Button variant="ghost" size="2xs" disabled={jobs === at('confirming')}>
								Reject
							</Button>
						</div>
					</div>
				</li>
			</ul>
		{/if}
	</li>
{/snippet}

<div
	class="app-ui relative min-h-0 flex-1 overflow-hidden"
	role="img"
	aria-label="A demo chat: asked to run Update docs whenever a pull request merges, the agent looks up the pull-requests:ship-changed event and asks to save the routine Docs after merge. Allowed once, it saves as a draft. On the Jobs page, the draft is promoted to candidate, a merge waits for confirmation and is confirmed, then it is promoted to routine."
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
							label="Docs routine"
							selected
							closeLabel="Close Docs routine"
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
									Whenever one of my pull requests merges, run Update docs.
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
								'Malini · Routines Save',
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
											Save routine ‘{ROUTINE}’
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
													Save routine ‘{ROUTINE}’
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
											Fork to new chat
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
						<Button size="sm" variant="ghost">Jobs</Button>
						<Button size="sm" variant="ghost" active>Routines</Button>
					</nav>
				</header>
				<div class="relative min-h-0 flex-1 overflow-hidden">
					<div
						bind:this={routinesViewport}
						class="routines-viewport relative h-full w-full overflow-x-hidden overflow-y-auto"
						onscroll={showThumb}
					>
						<div class="mx-auto w-full max-w-[720px] px-8 pb-16">
							<section class="space-y-8">
								<header>
									<h2 class="text-fg-default text-base font-semibold tracking-tight">Routines</h2>
									<p class="text-fg-tertiary mt-1 text-xs">
										A routine runs its steps in order when its trigger fires, or when you run it. It
										starts as a draft, earns a promotion to candidate where every triggered run asks
										first, and becomes a routine that runs unattended.
									</p>
								</header>
								{#each groups as group (group.status)}
									<section class="space-y-3" data-group={group.status}>
										<div>
											<h3 class="text-fg-default text-sm font-medium">
												{group.heading}
												{#if status === group.status}
													<span class="text-fg-tertiary font-normal">(1)</span>
												{/if}
											</h3>
											<p class="text-fg-tertiary mt-0.5 text-xs">{group.description}</p>
										</div>
										{#if status === group.status}
											<ul class="space-y-2">
												{@render routineRow()}
											</ul>
										{:else}
											<p class="text-fg-tertiary text-xs">{group.empty}</p>
										{/if}
									</section>
								{/each}
								<section class="space-y-3">
									<div>
										<h3 class="text-fg-default text-sm font-medium">New routine</h3>
										<p class="text-fg-tertiary mt-0.5 text-xs">
											Name it, pick its trigger, and list its steps. It stays a draft until you
											promote it.
										</p>
									</div>
									<div class="space-y-3">
										<TextInput
											label="Label"
											placeholder="Fix flaky tests, then refresh the preview"
										/>
										<Select
											label="When"
											value="when I run it"
											options={[
												'when I run it',
												'when a new workstream is created',
												'when a frontend resource becomes ready',
												'when a frontend Docker container becomes ready',
											].map((phrase) => ({ value: phrase, label: phrase }))}
											hint="Only when you run it"
										/>
									</div>
								</section>
							</section>
						</div>
					</div>
					<div
						class={[
							'absolute top-0 right-0 bottom-0 z-20 w-2 transition-opacity',
							thumb.shown ? 'opacity-100' : 'opacity-0',
						]}
					>
						<span
							class="bg-border-default absolute right-0.5 w-1.5 rounded-full"
							style:height="{thumb.height}px"
							style:top="{thumb.top}px"
						></span>
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

	.routines-viewport {
		scroll-behavior: smooth;
		scrollbar-width: none;
	}

	.routines-viewport::-webkit-scrollbar {
		display: none;
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

		.routines-viewport {
			scroll-behavior: auto;
		}

		.live,
		.markdown-stream-token {
			animation: none;
		}
	}
</style>
