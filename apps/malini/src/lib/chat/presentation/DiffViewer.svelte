<script lang="ts">
	import {
		NO_LINE_CHANGE_LABEL,
		parseUnifiedDiff,
		type DiffFile,
		type DiffLine,
	} from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { escapeCodeText } from '$hyper-ui/components/code-tokens';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { highlightDiffLines, languageForPath, type CodeToken } from '@malini/extension-api';

	interface Props {
		diffText: string;
		selectedPath: string | null;
		class?: import('svelte/elements').ClassValue;
	}

	let { diffText, selectedPath, class: className }: Props = $props();

	const SHOWN_LINES = 400;
	const CAP_SLACK_LINES = 100;

	let showAll = $state(false);

	const parsedFiles = $derived(parseUnifiedDiff(diffText));
	const totalLines = $derived(
		parsedFiles.reduce(
			(sum, file) => sum + file.hunks.reduce((lines, hunk) => lines + hunk.lines.length, 0),
			0,
		),
	);
	const lineBudget = $derived(
		showAll || totalLines <= SHOWN_LINES + CAP_SLACK_LINES ? Infinity : SHOWN_LINES,
	);
	const shownLines = $derived(budgetedLines(parsedFiles, lineBudget));
	const highlighted = $derived(new Map(parsedFiles.map((file) => [file, lineHtml(file)])));

	function budgetedLines(
		files: readonly DiffFile[],
		budget: number,
	): ReadonlyMap<DiffFile['hunks'][number], readonly DiffLine[]> {
		const shown = new Map<DiffFile['hunks'][number], readonly DiffLine[]>();
		let remaining = budget;
		for (const hunk of files.flatMap((file) => file.hunks)) {
			shown.set(hunk, hunk.lines.slice(0, Math.max(0, remaining)));
			remaining -= hunk.lines.length;
		}
		return shown;
	}

	function lineHtml(file: DiffFile): ReadonlyMap<DiffLine, string> {
		const tokens = lineTokens(file);
		return new Map([...tokens].map(([line, lineTokens]) => [line, tokensHtml(line, lineTokens)]));
	}

	function tokensHtml(line: DiffLine, tokens: readonly CodeToken[]): string {
		return tokens
			.map((token) => {
				const tag = token.changed ? changeTag(line) : 'span';
				return `<${tag} class="tok-${token.kind}">${escapeCodeText(token.text)}</${tag}>`;
			})
			.join('');
	}

	function pathOf(file: DiffFile): string {
		return file.newPath ?? file.oldPath ?? '';
	}

	function lineTokens(file: DiffFile): ReadonlyMap<DiffLine, readonly CodeToken[]> {
		const lines = file.hunks.flatMap((hunk) => hunk.lines);
		const tokens = highlightDiffLines(
			lines.map((line) => ({
				text: line.text,
				side: line.kind === 'deleted' ? 'old' : line.kind === 'added' ? 'new' : 'both',
			})),
			languageForPath(pathOf(file)),
		);
		return new Map(lines.map((line, index) => [line, tokens[index] ?? []]));
	}

	function lineRowClass(line: DiffLine): string {
		if (line.kind === 'added') {
			return 'border-l-2 border-l-success-content bg-success-content/12';
		}
		if (line.kind === 'deleted') {
			return 'border-l-2 border-l-error-content bg-error-content/10';
		}
		return 'border-l-2 border-l-transparent';
	}

	function signClass(line: DiffLine): string {
		if (line.kind === 'added') {
			return 'text-success-content';
		}
		if (line.kind === 'deleted') {
			return 'text-error-content';
		}
		return 'text-fg-tertiary';
	}

	function signChar(line: DiffLine): string {
		if (line.kind === 'added') {
			return '+';
		}
		if (line.kind === 'deleted') {
			return '−';
		}
		return '';
	}

	function changeTag(line: DiffLine): 'ins' | 'del' | 'span' {
		if (line.kind === 'added') return 'ins';
		if (line.kind === 'deleted') return 'del';
		return 'span';
	}

	function testIdForLine(line: DiffLine): string {
		if (line.kind === 'added') {
			return 'diff-line-added';
		}
		if (line.kind === 'deleted') {
			return 'diff-line-deleted';
		}
		return 'diff-line-context';
	}
</script>

<section
	class={[
		'bg-surface-150 text-fg-default flex h-full min-h-0 w-full flex-col overflow-hidden',
		className,
	]}
	data-testid="diff-viewer"
>
	{#if parsedFiles.length === 0}
		<div
			class="flex flex-1 flex-col items-center justify-center gap-1.5 px-8 text-center"
			data-testid="diff-empty"
		>
			<p class="text-fg-secondary text-sm font-medium">
				{selectedPath ? 'No diff to display' : 'Select a file'}
			</p>
			<p class="text-fg-tertiary max-w-[34ch] text-xs leading-relaxed">
				{selectedPath
					? 'This file has no textual changes to show.'
					: 'Pick a changed file above to view its diff.'}
			</p>
		</div>
	{:else}
		<div class="styled-scrollbar min-h-0 flex-1 overflow-auto">
			<div class="min-w-max">
				{#each parsedFiles as file (pathOf(file))}
					<div data-diff-file={pathOf(file)}>
						<div
							class="border-surface-50-border bg-surface-50 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5"
						>
							<FileTypeIcon path={pathOf(file)} size={14} />
							<span class="text-fg-default min-w-0 flex-1 truncate font-mono text-xs">
								{pathOf(file)}
							</span>
							{#if file.noLineChange}
								<span class="text-3xs text-fg-tertiary shrink-0 leading-none">
									{NO_LINE_CHANGE_LABEL[file.noLineChange]}
								</span>
							{:else}
								<span class="text-3xs shrink-0 font-mono leading-none tabular-nums">
									{#if file.additions > 0}<span class="text-success-content">
											+{file.additions}
										</span>{/if}{#if file.deletions > 0}<span class="text-error-content ml-1.5">
											−{file.deletions}
										</span>{/if}
								</span>
							{/if}
						</div>

						{#if file.hunks.length === 0}
							<div class="text-fg-tertiary px-3 py-2 text-xs">
								{file.noLineChange === 'binary'
									? 'Binary file - its contents are not shown.'
									: 'No textual diff available.'}
							</div>
						{:else}
							{#each file.hunks as hunk (hunk.header)}
								{@const lines = shownLines.get(hunk) ?? []}
								{#if lines.length > 0}
									<div class="font-mono text-xs" data-testid="diff-hunk">
										<div
											class="border-surface-50-border bg-surface-50 text-3xs text-fg-secondary border-y px-3 py-1 font-medium"
										>
											{hunk.header}
										</div>
										{#each lines as line, lineIndex (lineIndex)}
											<div
												class={[
													'leading-code grid grid-cols-[2.5rem_2.5rem_0.75rem_1fr] items-baseline pr-6',
													lineRowClass(line),
												]}
												data-line-kind={line.kind}
												data-testid={testIdForLine(line)}
											>
												<span
													class="text-3xs leading-code text-fg-tertiary py-0.5 pr-2 text-right tabular-nums select-none"
												>
													{line.oldLine ?? ''}
												</span>
												<span
													class="border-border-subtle text-3xs leading-code text-fg-tertiary border-r py-0.5 pr-2 text-right tabular-nums select-none"
												>
													{line.newLine ?? ''}
												</span>
												<span
													aria-hidden="true"
													class={[
														'text-3xs leading-code py-0.5 pl-1.5 text-center font-medium select-none',
														signClass(line),
													]}
												>
													{signChar(line)}
												</span>
												<span class="code-tokens py-0.5 pl-1 whitespace-pre">
													{@html highlighted.get(file)?.get(line) ?? ''}
												</span>
											</div>
										{/each}
									</div>
								{/if}
							{/each}
						{/if}
					</div>
				{/each}
				{#if lineBudget !== Infinity}
					<div class="px-3 py-2">
						<Button size="xs" variant="ghost" onclick={() => (showAll = true)}>
							Show all {totalLines} lines
						</Button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>
