<script module lang="ts">
	import type { Repository } from '$shared/repositories/domain/repository';
	import type { Workstream } from '$shared/repositories/domain/workstream';

	export type RepositoryContextMenuTarget = Readonly<{
		repository: Repository;
		workstreams: readonly Workstream[];
		x: number;
		y: number;
	}>;
</script>

<script lang="ts">
	import { Icon } from '$hyper-ui/icons';
	import { DropdownItem } from '$hyper-ui/components/dropdown';
	import { DropdownLayer } from '$hyper-ui/components/dropdown-layer';
	import { setRepositoryHiddenCommand } from '$shared/repositories/application/commands/set-repository-hidden.command';
	import { repositoryPreparationQuery } from '$shared/repositories/application/queries/repository-preparation.query.svelte';
	import { workstreamNativeExistenceQuery } from '$shared/repositories/application/queries/workstream-native-existence.query.svelte';
	import { workstreamCount } from '$shared/repositories/domain/workstream-retirement';
	import { repositoryWebUrl } from '$shared/repositories/domain/repository-context';
	import { externalUrlService } from '$shared/system/external-url.service';

	interface Props {
		target: RepositoryContextMenuTarget | null;
		onclose: () => void;
		onremove: ((repository: Repository, workstreams: readonly Workstream[]) => void) | undefined;
	}

	let { target, onclose, onremove }: Props = $props();

	let anchor = $state<HTMLDivElement | null>(null);
	let armedFor = $state.raw<RepositoryContextMenuTarget | null>(null);
	const nativeExistence = $derived(workstreamNativeExistenceQuery.data);
	const armed = $derived(target !== null && armedFor === target);
	const cloning = $derived(
		target !== null && repositoryPreparationQuery.data(target.repository).kind === 'preparing',
	);
	const blocked = $derived(
		cloning ||
			(target?.workstreams.some((workstream) => nativeExistence(workstream.id) === 'in-flight') ??
				false),
	);
	const removal = $derived.by(() => {
		const fullName = target?.repository.fullName ?? '';
		const count = target?.workstreams.length ?? 0;
		if (cloning)
			return { label: 'Remove after the clone finishes', ariaLabel: `Remove ${fullName}` };
		if (blocked) return { label: 'Remove after setup finishes', ariaLabel: `Remove ${fullName}` };
		if (!armed) return { label: 'Remove repository', ariaLabel: `Remove ${fullName}` };
		if (count === 0)
			return { label: 'Click again to remove', ariaLabel: `Confirm remove ${fullName}` };
		const listed = workstreamCount(count);
		return {
			label: `Delete ${listed} and remove`,
			ariaLabel: `Delete ${listed} and remove ${fullName}`,
		};
	});

	function close(): void {
		armedFor = null;
		onclose();
	}

	const webUrl = $derived(repositoryWebUrl(target?.repository.remoteUrl ?? null));

	function onOpenWeb(): void {
		if (!webUrl) return;
		const url = webUrl;
		close();
		void externalUrlService.open(url).catch(() => undefined);
	}

	function onHide(): void {
		if (!target) return;
		const { repository } = target;
		close();
		setRepositoryHiddenCommand(repository, true);
	}

	function onRemove(): void {
		if (!target || blocked) return;
		if (!armed) {
			armedFor = target;
			return;
		}
		const { repository, workstreams } = target;
		close();
		onremove?.(repository, workstreams);
	}

	function bodyAnchor(node: HTMLDivElement): () => void {
		document.body.append(node);
		anchor = node;
		return () => {
			node.remove();
			if (anchor === node) anchor = null;
		};
	}
</script>

{#if target}
	{#key target}
		<div
			{@attach bodyAnchor}
			class="pointer-events-none fixed size-0"
			style:left="{target.x}px"
			style:top="{target.y}px"
			data-dropdown-anchor
		></div>
	{/key}
{/if}

<DropdownLayer
	role={null}
	open={target !== null && anchor !== null}
	{anchor}
	onclose={close}
	offset={2}
	restoreFocusToAnchor={false}
	panelClass="w-max min-w-44 rounded-xl border-[0.5px] border-surface-elevated-border bg-surface-elevated p-1.5"
	testId="repository-context-menu"
>
	<div role="menu" aria-label="Repository actions" class="space-y-0.5">
		{#if webUrl}
			<DropdownItem
				role="menuitem"
				focusOnHover={false}
				class="gap-2.5"
				aria-label={`Open ${target?.repository.fullName ?? ''} on GitHub`}
				onclick={onOpenWeb}
			>
				<Icon name="external-link" class="shrink-0" size={15} />
				Open on GitHub
			</DropdownItem>
		{/if}
		<DropdownItem
			role="menuitem"
			focusOnHover={false}
			class="gap-2.5"
			aria-label={`Hide ${target?.repository.fullName ?? ''}`}
			onclick={onHide}
		>
			<Icon name="eye-off" class="shrink-0" size={15} />
			Hide repository
		</DropdownItem>

		<div class="border-surface-elevated-border mx-1 my-1 border-t" role="separator"></div>

		<DropdownItem
			role="menuitem"
			variant="danger"
			focusOnHover={false}
			class="gap-2.5 disabled:cursor-not-allowed disabled:opacity-40"
			disabled={!onremove || blocked}
			aria-label={removal.ariaLabel}
			onclick={onRemove}
		>
			<Icon name="trash" class="shrink-0" size={15} />
			{removal.label}
		</DropdownItem>
	</div>
</DropdownLayer>
