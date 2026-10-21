<script lang="ts">
	import {
		parseUnifiedDiff,
		type DiffFile,
		type DiffLine,
	} from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { escapeCodeText } from '$hyper-ui/components/code-tokens';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { highlightDiffLines, languageForPath, type CodeToken } from '@malini/extension-api';

	interface Props {
		diffText: string;
	}

	let { diffText }: Props = $props();

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

<ScrollableDiv
	orientation="xy"
	class="max-h-80"
	viewportClass="max-h-80 max-w-full"
	testId="diff-viewer"
>
	<div class="text-fg-default min-w-max py-1 font-mono">
		{#each parsedFiles as file (pathOf(file))}
			<div data-diff-file={pathOf(file)}>
				{#if file.hunks.length === 0}
					<p class="text-2xs text-fg-tertiary px-2.5 py-2 font-sans">
						{file.noLineChange === 'binary'
							? 'Binary file - its contents are not shown.'
							: 'No textual diff available.'}
					</p>
				{:else}
					{#each file.hunks as hunk, hunkIndex (hunk.header)}
						{@const lines = shownLines.get(hunk) ?? []}
						{#if lines.length > 0}
							<div
								class={[
									'text-2xs',
									hunkIndex > 0 && 'border-surface-50-border mt-1 border-t-[0.5px]',
								]}
								data-testid="diff-hunk"
							>
								<div class="text-3xs text-fg-tertiary px-2.5 py-1">{hunk.header}</div>
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
											class="text-3xs leading-code text-fg-tertiary pr-2 text-right tabular-nums select-none"
										>
											{line.oldLine ?? ''}
										</span>
										<span
											class="border-border-subtle text-3xs leading-code text-fg-tertiary border-r pr-2 text-right tabular-nums select-none"
										>
											{line.newLine ?? ''}
										</span>
										<span
											aria-hidden="true"
											class={[
												'text-3xs leading-code pl-1.5 text-center font-medium select-none',
												signClass(line),
											]}
										>
											{signChar(line)}
										</span>
										<span class="code-tokens pl-1 whitespace-pre select-text">
											{@html highlighted.get(file)?.get(line) ?? ''}
										</span>
									</div>
								{/each}
							</div>
						{/if}
					{/each}
				{/if}
			</div>
		{:else}
			<p class="text-2xs text-fg-tertiary px-2.5 py-2 font-sans" data-testid="diff-empty">
				This file has no textual changes to show.
			</p>
		{/each}
		{#if lineBudget !== Infinity}
			<div class="px-2.5 py-1 font-sans">
				<Button size="xs" variant="ghost" onclick={() => (showAll = true)}>
					Show all {totalLines} lines
				</Button>
			</div>
		{/if}
	</div>
</ScrollableDiv>
