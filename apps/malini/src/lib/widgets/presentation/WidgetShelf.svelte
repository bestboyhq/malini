<script lang="ts">
	import type { WidgetDefinition } from '$contract/widgets';
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { glyphs } from '$hyper-ui/icons/glyphs.generated';
	import { GitHubUserAvatar } from '$shared/repositories/repositories.api';

	interface Props {
		widgets: readonly WidgetDefinition[];
		repository: string | null;
		me: string | null;
		onadd: (widget: WidgetDefinition) => void;
		onnew?: ((prompt: string, inNewChat: boolean) => void) | undefined;
	}

	let { widgets, repository, me, onadd, onnew }: Props = $props();

	const PROMPT = 'Make me a widget that shows ';
	const titleId = $props.id();

	let asking = $state(false);
	let wanted = $state('');
	let field = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (asking) field?.focus();
	});

	function iconOf(name: string | null): IconName {
		return name !== null && isIconName(name) ? name : 'layers';
	}

	function isIconName(name: string): name is IconName {
		return Object.hasOwn(glyphs, name);
	}

	function ask(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}
		if (event.key !== 'Enter' || event.isComposing || wanted.trim() === '') return;
		event.preventDefault();
		onnew?.(`${PROMPT}${wanted.trim()}`, event.metaKey);
		close();
	}

	function close(): void {
		asking = false;
		wanted = '';
	}
</script>

<div class="flex flex-col gap-3 pt-3">
	{#if onnew}
		{#if asking}
			<TextInput
				bind:value={wanted}
				bind:element={field}
				size="sm"
				ariaLabel="New widget"
				placeholder="What should it show? ⌘↵ for a new chat"
				onkeydown={ask}
				onblur={() => wanted.trim() === '' && close()}
			/>
		{:else}
			<Button
				variant="ghost"
				size="sm"
				class="text-fg-tertiary hover:text-fg-default self-start"
				onclick={() => (asking = true)}
			>
				<Icon name="plus" size={14} />New widget
			</Button>
		{/if}
	{/if}
	{#if widgets.length > 0}
		<section class="flex flex-col gap-0.5" aria-labelledby={titleId}>
			<h3 id={titleId} class="text-fg-tertiary text-2xs px-2 pb-1 leading-4">
				{repository ? `In ${repository}` : 'In this repository'}
			</h3>
			<ul class="flex flex-col">
				{#each widgets as widget (widget.id)}
					{@const madeBy = widget.author !== null && widget.author !== me ? widget.author : null}
					<li class="hover:bg-surface-50 flex h-8 items-center gap-2 rounded-lg pr-1 pl-2">
						<Icon name={iconOf(widget.icon)} size={14} class="text-fg-tertiary shrink-0" />
						<span class="text-fg-secondary min-w-0 flex-1 truncate text-xs">{widget.title}</span>
						{#if madeBy !== null}
							<GitHubUserAvatar login={madeBy} label="Made by {madeBy}" size={14} />
						{/if}
						<Button
							variant="ghost"
							size="xs"
							ariaLabel="Add {widget.title}"
							onclick={() => onadd(widget)}
						>
							Add
						</Button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
