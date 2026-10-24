<script lang="ts">
	import { copyImageCommand } from '$lib/chat/application/commands/copy-image.command';
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { newChatRequestId } from '$lib/chat/domain/chat-request';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { Icon } from '$hyper-ui/icons';
	import { workstreamByIdQuery } from '$shared/repositories/repositories.api';
	import { WORKSTREAM_IMAGE_ATTRIBUTE, workstreamImageFilePath } from './workstream-images';

	interface Props {
		workstreamId: string;
	}

	let { workstreamId }: Props = $props();

	const workstreamRoot = $derived(workstreamByIdQuery.data(workstreamId)?.path ?? null);

	type Target = Readonly<{
		image: HTMLImageElement;
		path: string;
		x: number;
		y: number;
		host: Element;
	}>;

	let target = $state.raw<Target | null>(null);
	let anchor = $state<HTMLDivElement | null>(null);

	function onContextMenu(event: MouseEvent): void {
		if (event.defaultPrevented || !(event.target instanceof Element)) return;
		const image = event.target.closest(`img[${WORKSTREAM_IMAGE_ATTRIBUTE}]`);
		const path = image?.getAttribute(WORKSTREAM_IMAGE_ATTRIBUTE);
		if (!(image instanceof HTMLImageElement) || !path) return;
		event.preventDefault();
		target = {
			image,
			path,
			x: event.clientX,
			y: event.clientY,
			host: image.closest('[role="dialog"]') ?? document.body,
		};
	}

	function close(): void {
		target = null;
	}

	function onCopyImage(): void {
		const image = target?.image;
		close();
		if (image) copyImageCommand(pngDataUrl(image));
	}

	function onCopyPath(): void {
		const path = target?.path;
		close();
		if (path) {
			copyTextCommand({
				requestId: newChatRequestId(),
				text: workstreamImageFilePath(workstreamRoot, path),
			});
		}
	}

	async function pngDataUrl(image: HTMLImageElement): Promise<string> {
		const readable = new Image();
		readable.crossOrigin = 'anonymous';
		readable.src = image.currentSrc;
		await readable.decode();
		const canvas = document.createElement('canvas');
		canvas.width = readable.naturalWidth;
		canvas.height = readable.naturalHeight;
		canvas.getContext('2d')?.drawImage(readable, 0, 0);
		return canvas.toDataURL('image/png');
	}

	function cursorAnchor(node: HTMLDivElement, host: Element): { destroy: () => void } {
		host.append(node);
		anchor = node;
		return {
			destroy: () => {
				node.remove();
				if (anchor === node) anchor = null;
			},
		};
	}
</script>

<svelte:document oncontextmenu={onContextMenu} />

{#if target}
	<div
		use:cursorAnchor={target.host}
		class="pointer-events-none fixed size-0"
		style:left="{target.x}px"
		style:top="{target.y}px"
		data-dropdown-anchor
	></div>
{/if}

<DropdownLayer
	open={target !== null && anchor !== null}
	{anchor}
	onclose={close}
	offset={2}
	restoreFocusToAnchor={false}
	panelClass="min-w-40 overflow-hidden rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="image-context-menu"
>
	<DropdownItem role="menuitem" onclick={onCopyImage}>
		<Icon name="copy" size={14} class="text-fg-tertiary shrink-0" />
		Copy image
	</DropdownItem>
	<DropdownItem role="menuitem" onclick={onCopyPath}>
		<Icon name="folder-open" size={14} class="text-fg-tertiary shrink-0" />
		Copy path
	</DropdownItem>
</DropdownLayer>
