<script module lang="ts">
	export const at = {
		prompt: 1,
		thinking: 2,
		open: 3,
		opened: 4,
		type: 5,
		typed: 6,
		click: 7,
		clicked: 8,
		shot: 9,
		shotDone: 10,
		reply: 11,
		done: 12,
		pick: 13,
		hoverPay: 14,
		hoverError: 15,
		lock: 16,
		typing: 17,
		sent: 18,
		next: 19,
	} as const;

	export const followUp = 'Make this red and bold.';
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { asset } from '$app/paths';
	import { cubicOut, quartOut } from 'svelte/easing';
	import { fly, type TransitionConfig } from 'svelte/transition';
	import { BrowserTab } from '@malini/hyper-ui/components/browser-tab';
	import { IconButton } from '@malini/hyper-ui/components/icon-button';
	import { LoadingCircle } from '@malini/hyper-ui/components/loading-circle';
	import { ShimmerText } from '@malini/hyper-ui/components/shimmer-text';
	import { TextInput } from '@malini/hyper-ui/components/text-input';
	import { BusyIcon, Icon, type IconName } from '@malini/hyper-ui/icons';

	interface Props {
		step: number;
		typed: number;
		elapsed: string;
	}

	let { step, typed, elapsed }: Props = $props();

	type Box = { left: number; top: number; width: number; height: number };

	const firstPrompt = 'Pay with the declined test card and screenshot it.';
	const chatTitle = 'Pay with the declined test card';
	const reply = 'The decline message is gray and easy to miss.';
	const easing = 'cubic-bezier(0.23, 1, 0.32, 1)';
	const stiffness = 420;

	const tools: readonly {
		operation: string;
		target: string;
		icon: IconName;
		start: number;
		end: number;
	}[] = [
		{
			operation: 'Browser Open',
			target: 'localhost:5173',
			icon: 'note',
			start: at.open,
			end: at.opened,
		},
		{
			operation: 'Browser Type',
			target: '#card',
			icon: 'wrench',
			start: at.type,
			end: at.typed,
		},
		{
			operation: 'Browser Click',
			target: 'button.pay',
			icon: 'wrench',
			start: at.click,
			end: at.clicked,
		},
		{
			operation: 'Browser Screenshot',
			target: '',
			icon: 'wrench',
			start: at.shot,
			end: at.shotDone,
		},
	];

	const fileIcons = {
		'folder-src': asset('/file-icons/folder-src.svg'),
		'folder-resource': asset('/file-icons/folder-resource.svg'),
		'folder-test': asset('/file-icons/folder-test.svg'),
		git: asset('/file-icons/git.svg'),
		nodejs: asset('/file-icons/nodejs.svg'),
		readme: asset('/file-icons/readme.svg'),
		svelte: asset('/file-icons/svelte.svg'),
		tsconfig: asset('/file-icons/tsconfig.svg'),
		vite: asset('/file-icons/vite.svg'),
		image: asset('/file-icons/image.svg'),
	};

	type FileIcon = keyof typeof fileIcons;

	const files: readonly { name: string; icon: FileIcon; count?: number }[] = [
		{ name: 'src', icon: 'folder-src', count: 41 },
		{ name: 'static', icon: 'folder-resource', count: 3 },
		{ name: 'tests', icon: 'folder-test', count: 12 },
		{ name: '.gitignore', icon: 'git' },
		{ name: 'package.json', icon: 'nodejs' },
		{ name: 'README.md', icon: 'readme' },
		{ name: 'svelte.config.js', icon: 'svelte' },
		{ name: 'tsconfig.json', icon: 'tsconfig' },
		{ name: 'vite.config.ts', icon: 'vite' },
	];

	const chatEmpty = $derived(step < at.prompt);
	const agentTab = $derived(step >= at.open);
	const loading = $derived(step === at.open);
	const filled = $derived(step >= at.type);
	const fieldFocused = $derived(step >= at.type && step < at.click);
	const paying = $derived(step === at.click);
	const declined = $derived(step >= at.clicked);
	const picking = $derived(step >= at.pick && step < at.sent);
	const hinting = $derived(step >= at.pick && step < at.lock);
	const locked = $derived(step >= at.lock && step < at.sent);
	const runOneOpen = $derived(step >= at.prompt && step < at.done);
	const runTwo = $derived(step >= at.sent);
	const draft = $derived(step === at.typing ? followUp.slice(0, typed) : '');
	const agentRunning = $derived(runOneOpen || runTwo);

	let pay: HTMLElement | undefined = $state();
	let decline: HTMLElement | undefined = $state();
	let pageWidth = $state(0);
	let pageHeight = $state(0);
	let tagWidth = $state(0);
	let panelHeight = $state(110);

	const payBox = $derived(pay && pageWidth ? boxOf(pay) : null);
	const declineBox = $derived(decline && pageWidth ? boxOf(decline) : null);
	const hovered = $derived(
		step === at.hoverPay ? payBox : step >= at.hoverError && step < at.sent ? declineBox : null,
	);
	const hoveredName = $derived(step === at.hoverPay ? 'button.pay' : 'p.error');
	const panelWidth = $derived(Math.min(340, pageWidth - 16));
	const panelBelow = $derived(
		declineBox !== null && pageHeight - (declineBox.top + declineBox.height) - 16 >= panelHeight,
	);

	function toolLabel(operation: string, target: string, running: boolean): string {
		if (target) return `Malini · ${operation} · ${target}`;
		return running ? `Running Malini · ${operation}` : `Malini · ${operation}`;
	}

	function boxOf(element: HTMLElement): Box {
		return {
			left: element.offsetLeft,
			top: element.offsetTop,
			width: element.offsetWidth,
			height: element.offsetHeight,
		};
	}

	function size(box: Box | null): string {
		return box ? `${Math.round(box.width)} × ${Math.round(box.height)}` : '';
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), Math.max(min, max));
	}

	function textIn(_node: Element): TransitionConfig {
		if (step === 0) return { duration: 0 };
		if (reducedMotion()) return { duration: 160, css: (t) => `opacity: ${t};` };
		return {
			duration: 220,
			easing: quartOut,
			css: (t, u) => `opacity: ${t}; translate: 0 ${u * 5}px; filter: blur(${u * 2}px);`,
		};
	}

	function textOut(_node: Element): TransitionConfig {
		if (step === 0) return { duration: 0 };
		if (reducedMotion()) return { duration: 120, css: (t) => `opacity: ${t};` };
		return {
			duration: 140,
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; translate: 0 ${u * -5}px; filter: blur(${u * 2}px);`,
		};
	}

	function reducedMotion(): boolean {
		return matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	const arrive: Attachment<HTMLElement> = (node) => {
		if (reducedMotion()) return;
		node.animate(
			[
				{ transform: 'translateY(8px)', opacity: '0' },
				{ transform: 'translateY(0)', opacity: '1' },
			],
			{ duration: 240, easing },
		);
	};

	const rise: Attachment<HTMLElement> = (node) => {
		if (reducedMotion()) return;
		node.animate([{ transform: 'translateY(calc(100% + 34px))' }, { transform: 'translateY(0)' }], {
			duration: 240,
			easing,
		});
	};

	function springStep(
		state: { position: number; velocity: number },
		target: number,
		elapsedMs: number,
	): void {
		const damping = 2 * Math.sqrt(stiffness);
		let remaining = Math.min(elapsedMs, 34) / 1000;
		while (remaining > 0) {
			const dt = Math.min(remaining, 1 / 240);
			state.velocity += (stiffness * (target - state.position) - damping * state.velocity) * dt;
			state.position += state.velocity * dt;
			remaining -= dt;
		}
		if (Math.abs(target - state.position) < 0.5 && Math.abs(state.velocity) < 8) {
			state.position = target;
			state.velocity = 0;
		}
	}

	const followBottom: Attachment<HTMLElement> = (scroller) => {
		const list = scroller.firstElementChild;
		if (!(list instanceof HTMLElement)) return;
		const glide = { position: 0, velocity: 0 };
		let target = 0;
		let frame = 0;
		let last = 0;
		const tick = (now: number) => {
			springStep(glide, target, now - last);
			last = now;
			scroller.scrollTop = glide.position;
			frame = glide.position === target ? 0 : requestAnimationFrame(tick);
		};
		const observer = new ResizeObserver(() => {
			target = Math.max(0, list.offsetHeight - scroller.clientHeight);
			if (target <= glide.position || reducedMotion()) {
				cancelAnimationFrame(frame);
				frame = 0;
				glide.position = target;
				glide.velocity = 0;
				scroller.scrollTop = target;
				return;
			}
			if (frame) return;
			last = performance.now();
			frame = requestAnimationFrame(tick);
		});
		observer.observe(list);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	};

	const glideRows: Attachment<HTMLElement> = (container) => {
		type Row = { element: HTMLElement; top: number; position: number; velocity: number };
		let rows: Row[] = [];
		let frame = 0;
		let last = 0;
		const paint = () => {
			let below: number | null = null;
			for (const row of rows.toReversed()) {
				const overlap = below === null ? 0 : Math.ceil(row.position - below);
				row.element.style.translate = Math.abs(row.position) < 0.5 ? '' : `0 ${row.position}px`;
				row.element.style.maskImage =
					overlap < 1
						? ''
						: `linear-gradient(to top, transparent ${overlap}px, black ${overlap + Math.min(24, overlap)}px)`;
				below = row.position;
			}
		};
		const tick = (now: number) => {
			for (const row of rows) springStep(row, 0, now - last);
			last = now;
			paint();
			frame = rows.some((row) => row.position !== 0) ? requestAnimationFrame(tick) : 0;
		};
		const measure = () => {
			const known = new Map(rows.map((row) => [row.element, row]));
			let moved = false;
			rows = [...container.children].flatMap((element) => {
				if (!(element instanceof HTMLElement) || element.hasAttribute('data-prompt-row')) return [];
				const top = element.offsetTop;
				const row = known.get(element);
				if (!row) return [{ element, top, position: 0, velocity: 0 }];
				if (Math.abs(row.top - top) >= 0.5 && !reducedMotion()) {
					row.position += row.top - top;
					moved = true;
				}
				row.top = top;
				return [row];
			});
			if (!moved) return;
			paint();
			if (!frame) {
				last = performance.now();
				frame = requestAnimationFrame(tick);
			}
		};
		const observer = new MutationObserver(measure);
		observer.observe(container, { childList: true, subtree: true });
		measure();
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	};
</script>

<div class="bg-surface-root @container flex h-[calc(100%+5rem)] items-start">
	<div class="hidden h-[calc(100%-5rem)] min-w-0 flex-1 flex-col @min-[36.25rem]:flex">
		<div class="flex h-10 shrink-0 items-center pl-1">
			<div class="flex min-w-0 flex-1 items-center">
				<div class="relative flex min-w-0 flex-1 items-center gap-px overflow-hidden">
					<BrowserTab
						surface="band"
						label={chatEmpty ? 'New chat' : chatTitle}
						selected
						closeLabel="Close chat"
						tooltipPlacement="top"
						tabindex={-1}
						busy={agentRunning}
					/>
					<span class="flex size-7 shrink-0 items-center justify-center">
						<IconButton
							bare
							ariaLabel="Start a fresh chat"
							tabindex={-1}
							class="text-fg-tertiary hover:bg-tab-hover hover:text-fg-default focus-visible:ring-button-primary/40 relative grid size-5 cursor-pointer place-items-center rounded-sm outline-none before:absolute before:-inset-1 before:content-[''] focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-30"
						>
							<Icon name="plus" size={14} />
						</IconButton>
					</span>
				</div>
			</div>
		</div>
		<div class="relative flex min-h-0 flex-1 flex-col">
			{#if chatEmpty}
				<div
					class="chat-stage-inset grid min-h-0 flex-1 place-items-center px-6 pt-10 pb-10 text-center"
				>
					<div class="max-w-sm">
						<p class="text-fg-secondary text-sm">No chat yet</p>
						<p class="text-fg-tertiary mt-1 text-xs leading-5">
							Send a prompt below to start the first chat in this workstream.
						</p>
					</div>
				</div>
			{:else}
				<div class="flex h-full w-full flex-col overflow-hidden" {@attach followBottom}>
					<div class="chat-stage-inset flex grow flex-col">
						<ol class="chat-column flex flex-col gap-8 px-7 pt-2 pb-5 select-none">
							<li
								class={[
									'group/run relative flex flex-col gap-2 transition-opacity',
									runTwo && 'opacity-90',
								]}
								{@attach runTwo ? undefined : glideRows}
							>
								{@render promptRow(firstPrompt, false)}
								{#if step >= at.thinking}
									{@render thought(
										step < at.open,
										'I will open the dev server in my own tab first.',
										'Open the dev server in my tab, then pay with the declined card.',
									)}
								{/if}
								{#each tools as tool (tool.operation)}
									{#if step >= tool.start}
										{@render toolRow(
											toolLabel(tool.operation, tool.target, step < tool.end),
											tool.icon,
											step < tool.end,
										)}
									{/if}
								{/each}
								{#if step >= at.reply}
									<div class="text-fg-default w-full text-sm leading-relaxed" {@attach arrive}>
										<p class="select-text">{reply}</p>
									</div>
								{/if}
								{#if runOneOpen}
									{@render statusLine()}
								{/if}
								{#if step >= at.done}
									<div class="flex h-5 items-center justify-end gap-1.5">
										<div class="mr-auto flex min-w-0 items-center gap-1.5">
											<span class="flex">
												<span
													class="text-2xs text-fg-tertiary inline-flex h-5 shrink-0 items-center gap-1 rounded px-1"
												>
													<Icon name="branch" size={14} />
													Fork to new chat
												</span>
											</span>
										</div>
									</div>
								{/if}
							</li>
							{#if runTwo}
								<li class="group/run relative flex flex-col gap-2" {@attach glideRows}>
									{@render promptRow(followUp, true)}
									{#if step >= at.next}
										{@render thought(true, 'The decline text is p.error, under the plan name.', '')}
									{/if}
									{@render statusLine()}
								</li>
							{/if}
						</ol>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<div
		class="mr-3 ml-3 flex h-full min-w-0 flex-1 flex-col pt-3 @min-[36.25rem]:ml-0 @min-[36.25rem]:w-90 @min-[36.25rem]:flex-none"
	>
		<div class="dock">
			<div class="dock-git">
				<span class="flex min-w-0 flex-1">
					<span class="dock-status" role="status">
						{#key agentRunning}
							<span class="dock-line" in:textIn out:textOut>
								{#if agentRunning}
									<BusyIcon size={12} />
								{/if}
								<span class="dock-text">
									<span class="dock-label">
										{agentRunning ? 'Agent running' : 'Build something great'}
									</span>
								</span>
							</span>
						{/key}
					</span>
				</span>
			</div>
		</div>
		<section
			class="bg-surface-50 border-surface-50-border relative z-[1] -mt-6 mb-3 flex min-h-0 min-w-0 flex-1 shrink flex-col overflow-hidden rounded-3xl border-[0.5px]"
			aria-label="Inspector"
		>
			<div class="flex h-12 shrink-0 items-center gap-1 px-4 pt-1">
				<div
					class="inspector-tab-strip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden"
				>
					<BrowserTab label="Files" selected={!agentTab} closeLabel="Close Files" tabindex={-1}>
						{#snippet icon()}
							<span class="grid place-items-center" aria-hidden="true">
								<Icon name="files" size={14} />
							</span>
						{/snippet}
					</BrowserTab>
					{#if agentTab}
						<BrowserTab
							label={loading ? 'localhost:5173' : 'Checkout · Acme'}
							selected
							closeLabel="Close Checkout · Acme"
							tabindex={-1}
						>
							{#snippet icon()}
								<span class="grid place-items-center" aria-hidden="true">
									<Icon name="globe" size={14} />
								</span>
							{/snippet}
						</BrowserTab>
					{/if}
					<span class="shrink-0">
						<span class="flex size-7 items-center justify-center">
							<IconButton
								bare
								ariaLabel="Open inspector panel"
								ariaHasPopup="menu"
								ariaExpanded={false}
								tabindex={-1}
								class="text-fg-tertiary hover:bg-surface-50-selected hover:text-fg-default aria-expanded:bg-surface-50-selected aria-expanded:text-fg-default focus-visible:ring-button-primary/40 relative grid size-5 cursor-pointer place-items-center rounded-sm outline-none before:absolute before:-inset-1 before:content-[''] focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-30"
							>
								<Icon name="plus" size={14} />
							</IconButton>
						</span>
					</span>
				</div>
				{#if agentTab}
					<span class="shrink-0">
						<span class="flex">
							<IconButton
								ariaLabel="Arrange inspector panels"
								variant="ghost"
								size="md"
								ariaHasPopup="menu"
								ariaExpanded={false}
								tabindex={-1}
							>
								<Icon name="settings" size={14} />
							</IconButton>
						</span>
					</span>
				{/if}
				<span class="shrink-0">
					<span class="flex">
						<IconButton
							ariaLabel="Hide inspector"
							variant="ghost"
							size="md"
							ariaExpanded={true}
							tabindex={-1}
						>
							<Icon name="chevron-right" size={13} />
						</IconButton>
					</span>
				</span>
			</div>

			<div class="relative flex min-h-0 min-w-0 flex-1">
				{#if agentTab}
					<div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
						<div class="flex shrink-0 items-center gap-1 px-4 pt-0.5 pb-2">
							{@render toolbarButton('Back', 'chevron-left', true)}
							{@render toolbarButton('Forward', 'chevron-right', true)}
							{@render toolbarButton('Reload', 'refresh', false)}
							<TextInput
								type="url"
								size="xs"
								value="localhost:5173"
								ariaLabel="Page address"
								placeholder="Type a URL"
								autocomplete="off"
								readonly
								class="mx-1 min-w-0 flex-1"
								inputClass="text-xs"
							>
								{#snippet icon()}
									{#if loading}
										<LoadingCircle size={14} />
									{:else}
										<Icon name="globe" size={14} />
									{/if}
								{/snippet}
							</TextInput>
							<span class="flex shrink-0">
								<IconButton
									ariaLabel="Pick an element"
									variant={picking ? 'primary-soft' : 'ghost'}
									size="md"
									ariaPressed={picking}
									tabindex={-1}
								>
									<Icon name="pick-element" size={14} />
								</IconButton>
							</span>
							{@render toolbarButton('Open in your browser', 'external-link', false)}
						</div>
						<div
							class="border-surface-100-border bg-surface-100 relative mx-2 mb-2 min-h-0 flex-1 basis-[100vh] rounded-2xl border-[0.5px]"
						>
							<div class="web" bind:clientWidth={pageWidth} bind:clientHeight={pageHeight}>
								{#if !loading}
									<header class="web-header">
										<span class="web-logo"></span>
										Acme
									</header>
									<main class="web-main">
										<h1>Checkout</h1>
										<p class="web-plan">Acme Pro, billed monthly</p>
										{#if declined}
											<p class="web-error error" bind:this={decline}>Your card was declined.</p>
										{/if}
										<span class="web-label">Card number</span>
										<span class="web-field" class:focus={fieldFocused} class:filled>
											{filled ? '4000 0000 0000 0002' : '1234 1234 1234 1234'}
										</span>
										<span class="web-pay pay" class:busy={paying} bind:this={pay}>
											{paying ? 'Paying…' : 'Pay $49.00'}
										</span>
									</main>
								{/if}
								{#if picking}
									{@render picker()}
								{/if}
							</div>
						</div>
					</div>
				{:else}
					{@render filesPanel()}
				{/if}
			</div>
		</section>
	</div>
</div>

{#snippet fileIcon(icon: FileIcon, size: number)}
	<img
		src={fileIcons[icon]}
		alt=""
		aria-hidden="true"
		draggable="false"
		width={size}
		height={size}
		class="shrink-0 select-none"
		style="width: {size}px; height: {size}px;"
	/>
{/snippet}

{#snippet toolbarButton(label: string, icon: IconName, disabled: boolean)}
	<span class="flex shrink-0">
		<IconButton ariaLabel={label} variant="ghost" size="md" {disabled} tabindex={-1}>
			<Icon name={icon} size={14} />
		</IconButton>
	</span>
{/snippet}

{#snippet promptRow(text: string, element: boolean)}
	<div
		class="sticky-prompt-fade bg-surface-root sticky top-0 z-40 -mx-3 mb-3.5 flex w-[calc(100%+1.5rem)] flex-col items-start gap-1.5"
		data-prompt-row
		{@attach rise}
	>
		<div
			class="prompt-clamp group/prompt bg-surface-50 border-surface-50-border text-fg-default w-full rounded-xl border px-3 py-2.5 text-left text-sm leading-6 select-none"
		>
			<span class="prompt-clamp-body">{text}</span>
		</div>
		{#if element}
			<div class="flex w-full flex-wrap gap-1">
				<span class="flex max-w-56">
					<span
						class="border-chip-border bg-chip text-2xs text-fg-secondary inline-flex h-6 max-w-56 min-w-0 items-center gap-1 rounded-md border px-1.5"
					>
						{@render fileIcon('image', 12)}
						<span class="truncate">element.png</span>
					</span>
				</span>
			</div>
			<div class="flex w-full flex-col gap-1">
				<span
					class="border-chip-border bg-chip text-2xs text-fg-secondary inline-flex max-w-full items-start gap-1 rounded-md border px-1.5 py-1"
				>
					<Icon name="preview" class="mt-0.5 shrink-0" size={12} />
					<span class="flex min-w-0 flex-col gap-0.5">
						<span class="block truncate">Source: src/routes/+page.svelte:42:3</span>
						<span class="block truncate">
							Position: top={Math.round(declineBox?.top ?? 0)}px, left={Math.round(
								declineBox?.left ?? 0,
							)}px, width={Math.round(declineBox?.width ?? 0)}px, height={Math.round(
								declineBox?.height ?? 0,
							)}px
						</span>
						<span class="block truncate">
							HTML Element: &lt;p class="error"&gt;Your card was declined.&lt;/p&gt;
						</span>
					</span>
				</span>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet thought(live: boolean, preview: string, outcome: string)}
	<div class="text-fg-tertiary w-full text-sm" {@attach arrive}>
		<div class="flex min-h-6 items-center gap-2">
			<span class="relative h-3.5 w-3.5 shrink-0" aria-hidden="true">
				<span class="absolute inset-0 grid place-items-center">
					<Icon name="brain" size={14} />
				</span>
			</span>
			{#if live}
				<ShimmerText text="Thinking" class="shrink-0" />
			{:else}
				<span class="shrink-0">Thought for 1s</span>
			{/if}
			<span class="grid min-w-0 flex-1 overflow-hidden">
				{#key live}
					<span
						class="text-fg-tertiary/75 truncate [grid-area:1/1]"
						in:fly={{ y: 10, duration: 260, easing: cubicOut }}
					>
						{live ? preview : outcome}
					</span>
				{/key}
			</span>
		</div>
	</div>
{/snippet}

{#snippet toolRow(label: string, icon: IconName, running: boolean)}
	<div class="w-full" {@attach arrive}>
		<div class="text-sm">
			<div class="text-fg-tertiary flex min-h-6 items-center gap-2">
				<span class="relative h-3.5 w-3.5 shrink-0" aria-hidden="true">
					<span class="absolute inset-0 grid place-items-center">
						<span class={['grid place-items-center', running && 'live text-fg-secondary']}>
							<Icon name={icon} size={14} class="shrink-0" />
						</span>
					</span>
				</span>
				<span class="min-w-0 flex-1 truncate">{label}</span>
				{#if running}
					<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums">running…</span>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet statusLine()}
	<div class="flex min-h-6 items-center">
		<div class="flex min-w-0 flex-1 items-center gap-2 text-xs" {@attach arrive}>
			<span
				class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center"
				aria-hidden="true"
			>
				<BusyIcon size={12} />
			</span>
			<span class="text-fg-tertiary min-w-0 truncate font-mono tabular-nums">{elapsed}</span>
		</div>
	</div>
{/snippet}

{#snippet filesPanel()}
	<section class="repository-panel flex h-full min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex min-h-0 flex-1 flex-col">
			<div class="files-band">
				<span class="files-toggle">
					<span class="files-toggle-label">
						<svg class="files-chevron" viewBox="0 0 24 24" aria-hidden="true">
							<path d="m9 18 6-6-6-6" />
						</svg>
						<span>Files</span>
					</span>
					<span class="files-summary">64</span>
				</span>
				<span class="files-chip">
					<span>Changed</span>
					<span class="files-chip-count">0</span>
				</span>
			</div>
			<div class="files-tree">
				{#each files as file (file.name)}
					<span class="files-row">
						<span class="files-twisty">
							{#if file.count !== undefined}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
							{/if}
						</span>
						{@render fileIcon(file.icon, 16)}
						<span class="files-name" class:folder={file.count !== undefined}>{file.name}</span>
						{#if file.count !== undefined}
							<span class="files-count">{file.count}</span>
						{/if}
					</span>
				{/each}
			</div>
		</div>
	</section>
{/snippet}

{#snippet picker()}
	<div class="picker-layer">
		{#if hovered || locked}
			{@const box = locked ? declineBox : hovered}
			{#if box}
				<div
					class="picker-box"
					class:locked
					style:transform="translate({box.left}px, {box.top}px)"
					style:width="{box.width}px"
					style:height="{box.height}px"
				></div>
			{/if}
		{/if}
		{#if hovered && !locked}
			<div
				class="picker-tag"
				bind:offsetWidth={tagWidth}
				style:transform="translate({clamp(hovered.left, 6, pageWidth - tagWidth - 6)}px, {hovered.top -
					28}px)"
			>
				<span class="picker-tag-name">{hoveredName}</span>
				<span class="picker-tag-size">{size(hovered)}</span>
			</div>
		{/if}
		{#if hinting}
			<div class="picker-hint">
				<span>Click an element to ask about it</span>
				<span class="picker-hint-keys">Esc to cancel</span>
			</div>
		{/if}
		{#if locked && declineBox}
			<div
				class="picker-panel"
				bind:offsetHeight={panelHeight}
				style:width="{panelWidth}px"
				style:left="{clamp(declineBox.left, 8, pageWidth - panelWidth - 8)}px"
				style:top="{panelBelow
					? declineBox.top + declineBox.height + 8
					: declineBox.top - 8 - panelHeight}px"
				style:transform-origin={panelBelow ? 'top left' : 'bottom left'}
			>
				<div class="picker-panel-label">
					<span class="picker-panel-name">p.error</span>
					<span class="picker-panel-size">{size(declineBox)}</span>
				</div>
				<div class="picker-field">
					{#if draft}
						{draft}
						<span class="picker-caret"></span>
					{:else}
						<span class="picker-caret"></span>
						<span class="picker-placeholder">Ask about this element…</span>
					{/if}
				</div>
				<div class="picker-foot">
					<span class="picker-keys">Enter to send · Esc to cancel</span>
					<span class="picker-send" class:disabled={!draft}>
						<svg
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M8 12.75v-9.5M4.25 7 8 3.25 11.75 7" />
						</svg>
					</span>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<style>
	.dock {
		position: relative;
		isolation: isolate;
		display: flex;
		height: 80px;
		flex: none;
		align-items: center;
		padding: 0 16px 24px;
		border: 0.5px solid var(--color-surface-50-border);
		border-bottom: 0;
		border-radius: 24px 24px 0 0;
		background: var(--color-surface-50);
		--dock-stripe: light-dark(var(--color-surface-root-selected), var(--color-surface-50-border));
	}

	.dock::before {
		position: absolute;
		z-index: -1;
		inset: 0;
		border-radius: inherit;
		background: repeating-linear-gradient(225deg, var(--dock-stripe) 0 1px, transparent 0 50%) 0 0 /
			8px 8px;
		content: '';
		mask-image: linear-gradient(
			to bottom,
			black,
			color-mix(in srgb, black 35%, transparent) calc(100% - 24px)
		);
		pointer-events: none;
	}

	.dock-git {
		display: flex;
		height: 32px;
		min-width: 0;
		flex: 1 1 auto;
		align-items: center;
		gap: 10px;
	}

	.dock-status {
		display: grid;
		min-width: 0;
		flex: 1 1 auto;
		grid-template-columns: minmax(0, 1fr);
		color: var(--color-fg-secondary);
	}

	.dock-line {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
		grid-area: 1 / 1;
		font-size: var(--text-sm);
		line-height: 16px;
		white-space: nowrap;
	}

	.dock-text {
		display: flex;
		height: 16px;
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
	}

	.dock-label {
		min-width: 0;
		overflow: hidden;
		font-weight: 500;
		text-overflow: ellipsis;
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

	.repository-panel {
		color: var(--color-fg-default);
	}

	.files-band {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.625rem;
	}

	.files-toggle {
		display: flex;
		width: 100%;
		min-width: 0;
		min-height: 2.25rem;
		flex: 1;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem 0.25rem 0.75rem;
		color: var(--color-fg-tertiary);
	}

	.files-toggle-label {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.files-chevron {
		width: 0.75rem;
		height: 0.75rem;
		flex: none;
		color: var(--color-fg-tertiary);
		transform: rotate(90deg);
	}

	svg:not([fill]) {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.files-summary {
		display: flex;
		flex: none;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
	}

	.files-chip {
		display: inline-flex;
		height: 1.5rem;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.5rem;
		border-radius: 0.375rem;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
		white-space: nowrap;
	}

	.files-chip-count {
		color: var(--color-fg-tertiary);
		font-variant-numeric: tabular-nums;
	}

	.files-tree {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		padding: 0.125rem 0.375rem 0.5rem;
	}

	.files-row {
		display: flex;
		width: 100%;
		height: 1.75rem;
		flex: none;
		align-items: center;
		gap: 0.5rem;
		padding-right: 0.75rem;
		padding-left: 0.5rem;
		border-radius: var(--radius-lg);
	}

	.files-twisty {
		display: grid;
		width: 1rem;
		height: 1rem;
		flex: none;
		place-items: center;
		color: var(--color-fg-tertiary);
	}

	.files-twisty svg {
		width: 0.75rem;
		height: 0.75rem;
	}

	.files-name {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		color: var(--color-fg-secondary);
		font-size: var(--text-sm);
		line-height: var(--text-sm--line-height);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.files-name.folder {
		color: var(--color-fg-default);
	}

	.files-count {
		flex: none;
		color: var(--color-fg-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
	}

	.web {
		position: absolute;
		inset: -0.5px;
		overflow: hidden;
		border-radius: 16px;
		background: #fff;
		color: #18181b;
		font:
			14px/20px -apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			system-ui,
			sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.web-header {
		display: flex;
		height: 44px;
		align-items: center;
		gap: 10px;
		padding: 0 20px;
		border-bottom: 1px solid #e4e4e7;
		font-size: 15px;
		font-weight: 600;
	}

	.web-logo {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: #4f46e5;
	}

	.web-main {
		display: flex;
		flex-direction: column;
		padding: 16px 20px;
	}

	.web-main h1 {
		font-size: 18px;
		font-weight: 700;
		line-height: 26px;
		letter-spacing: -0.01em;
	}

	.web-plan {
		color: #71717a;
		font-size: 13px;
		line-height: 18px;
	}

	.web-label {
		margin-top: 14px;
		color: #3f3f46;
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
	}

	.web-field {
		display: flex;
		height: 36px;
		align-items: center;
		margin-top: 6px;
		padding: 0 12px;
		border: 1px solid #d4d4d8;
		border-radius: 8px;
		color: #a1a1aa;
		font-size: 13px;
		letter-spacing: 0.02em;
	}

	.web-field.filled {
		color: #18181b;
	}

	.web-field.focus {
		border-color: #4f46e5;
		box-shadow: 0 0 0 3px rgb(79 70 229 / 0.2);
	}

	.web-pay {
		display: grid;
		height: 40px;
		margin-top: 12px;
		place-items: center;
		border-radius: 8px;
		background: #4f46e5;
		color: #fff;
		font-weight: 600;
	}

	.web-pay.busy {
		opacity: 0.7;
	}

	.web-error {
		margin-top: 8px;
		line-height: 20px;
		color: #71717a;
		font-size: 13px;
	}

	.picker-layer {
		position: absolute;
		inset: 0;
		color: #f7f5f3;
		font:
			13px/20px -apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			system-ui,
			sans-serif;
		letter-spacing: normal;
		text-align: left;
		pointer-events: none;
	}

	.picker-box {
		position: absolute;
		top: 0;
		left: 0;
		border: 1.5px solid #3e9df3;
		border-radius: 3px;
		background: #3e9df31f;
		transition:
			transform 80ms ease-out,
			width 80ms ease-out,
			height 80ms ease-out;
	}

	.picker-box.locked {
		border-width: 2px;
		background: transparent;
		box-shadow: 0 0 0 3px #3e9df359;
	}

	.picker-tag {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		max-width: calc(100% - 12px);
		align-items: baseline;
		gap: 6px;
		padding: 2px 7px;
		border: 1px solid #42403f;
		border-radius: 6px;
		background: #312f2d;
		box-shadow: 0 2px 8px #00000033;
		font:
			500 11px/16px ui-monospace,
			'SF Mono',
			Menlo,
			monospace;
		white-space: nowrap;
	}

	.picker-tag-name,
	.picker-panel-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.picker-tag-size,
	.picker-panel-size {
		flex: none;
		color: #86817e;
		font-weight: 400;
	}

	.picker-hint {
		position: absolute;
		top: 12px;
		left: 50%;
		display: flex;
		gap: 8px;
		padding: 6px 12px;
		border: 1px solid #42403f;
		border-radius: 999px;
		background: #312f2d;
		box-shadow: 0 8px 24px #00000066;
		font-size: 12px;
		line-height: 16px;
		white-space: nowrap;
		transform: translateX(-50%);
	}

	.picker-hint-keys {
		color: #86817e;
	}

	.picker-panel {
		position: absolute;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 8px 8px 12px;
		border: 1px solid #3e9df3;
		border-radius: 12px;
		background: #312f2d;
		box-shadow:
			0 0 0 3px #3e9df359,
			0 12px 32px #00000066,
			0 2px 6px #00000033;
		animation: picker-in 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.picker-panel-label {
		display: flex;
		gap: 6px;
		padding-right: 4px;
		color: #86817e;
		font:
			11px/16px ui-monospace,
			'SF Mono',
			Menlo,
			monospace;
		white-space: nowrap;
	}

	.picker-field {
		min-height: 40px;
		padding-right: 4px;
		color: #f7f5f3;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.picker-placeholder {
		color: #74706d;
	}

	.picker-caret {
		display: inline-block;
		width: 1.5px;
		height: 16px;
		margin-right: -1.5px;
		background: #3e9df3;
		vertical-align: -3px;
		animation: blink 1s steps(1) infinite;
	}

	.picker-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.picker-keys {
		color: #86817e;
		font-size: 11px;
		line-height: 16px;
	}

	.picker-send {
		display: grid;
		width: 28px;
		height: 28px;
		flex: none;
		place-items: center;
		border-radius: 999px;
		background: #fcfbfb;
		color: #161413;
	}

	.picker-send.disabled {
		background: #2a2927;
		color: #696563;
	}

	.picker-send svg {
		width: 16px;
		height: 16px;
	}

	@keyframes picker-in {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.98);
		}
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.live,
		.picker-caret,
		.picker-panel {
			animation: none;
		}

		.picker-box {
			transition: none;
		}
	}
</style>
