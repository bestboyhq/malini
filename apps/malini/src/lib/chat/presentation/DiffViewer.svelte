<script lang="ts">
	import type { DiffHunk, DiffLine } from '$shared/repositories/repositories.api';
	import { Button } from '$hyper-ui/components/button';
	import { escapeCodeText } from '$hyper-ui/components/code-tokens';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { highlightDiffLines, languageForPath, type CodeToken } from '@malini/extension-api';

	interface Props {
		hunks: readonly DiffHunk[];
		path: string;
	}

	let { hunks, path }: Props = $props();

	const SHOWN_LINES = 400;
	const CAP_SLACK_LINES = 100;

	let showAll = $state(false);

	const lines = $derived(hunks.flatMap((hunk) => hunk.lines));
	const numbered = $derived(lines.some((line) => line.oldLine !== null || line.newLine !== null));
	const lineBudget = $derived(
		showAll || lines.length <= SHOWN_LINES + CAP_SLACK_LINES ? Infinity : SHOWN_LINES,
	);
	const shownLines = $derived(budgetedLines(lineBudget));
	const highlighted = $derived(lineHtml());

	function budgetedLines(budget: number): ReadonlyMap<DiffHunk, readonly DiffLine[]> {
		const shown = new Map<DiffHunk, readonly DiffLine[]>();
		let remaining = budget;
		for (const hunk of hunks) {
			shown.set(hunk, hunk.lines.slice(0, Math.max(0, remaining)));
			remaining -= hunk.lines.length;
		}
		return shown;
	}

	function lineHtml(): ReadonlyMap<DiffLine, string> {
		const tokens = highlightDiffLines(
			lines.map((line) => ({
				text: line.text,
				side: line.kind === 'deleted' ? 'old' : line.kind === 'added' ? 'new' : 'both',
			})),
			languageForPath(path),
		);
		return new Map(lines.map((line, index) => [line, tokensHtml(line, tokens[index] ?? [])]));
	}

	function tokensHtml(line: DiffLine, tokens: readonly CodeToken[]): string {
		return tokens
			.map((token) => {
				const tag = token.changed ? changeTag(line) : 'span';
				return `<${tag} class="tok-${token.kind}">${escapeCodeText(token.text)}</${tag}>`;
			})
			.join('');
	}

	function lineRowClass(line: DiffLine): string {
		if (line.kind === 'added') return 'border-l-2 border-l-success-content bg-success-content/12';
		if (line.kind === 'deleted') return 'border-l-2 border-l-error-content bg-error-content/10';
		return 'border-l-2 border-l-transparent';
	}

	function signClass(line: DiffLine): string {
		if (line.kind === 'added') return 'text-success-content';
		if (line.kind === 'deleted') return 'text-error-content';
		return 'text-fg-tertiary';
	}

	function signChar(line: DiffLine): string {
		if (line.kind === 'added') return '+';
		if (line.kind === 'deleted') return '−';
		return '';
	}

	function changeTag(line: DiffLine): 'ins' | 'del' | 'span' {
		if (line.kind === 'added') return 'ins';
		if (line.kind === 'deleted') return 'del';
		return 'span';
	}

	function testIdForLine(line: DiffLine): string {
		if (line.kind === 'added') return 'diff-line-added';
		if (line.kind === 'deleted') return 'diff-line-deleted';
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
		{#each hunks as hunk, hunkIndex (hunkIndex)}
			{@const shown = shownLines.get(hunk) ?? []}
			{#if shown.length > 0}
				<div
					class={[
						'text-2xs',
						hunkIndex > 0 && 'border-surface-50-border mt-1 border-t-[0.5px] pt-1',
					]}
					data-testid="diff-hunk"
				>
					{#if hunk.header}
						<div class="text-3xs text-fg-tertiary px-2.5 py-1">{hunk.header}</div>
					{/if}
					{#each shown as line, lineIndex (lineIndex)}
						<div
							class={[
								'leading-code grid items-baseline pr-6',
								numbered ? 'grid-cols-[2.5rem_2.5rem_0.75rem_1fr]' : 'grid-cols-[1.5rem_1fr]',
								lineRowClass(line),
							]}
							data-line-kind={line.kind}
							data-testid={testIdForLine(line)}
						>
							{#if numbered}
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
							{/if}
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
								{@html highlighted.get(line) ?? ''}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/each}
		{#if lineBudget !== Infinity}
			<div class="px-2.5 py-1 font-sans">
				<Button size="xs" variant="ghost" onclick={() => (showAll = true)}>
					Show all {lines.length} lines
				</Button>
			</div>
		{/if}
	</div>
</ScrollableDiv>
