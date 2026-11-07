<script lang="ts" module>
	export type TerminalLine =
		| { kind: 'tool'; tool: string; text: string }
		| { kind: 'say'; text: string; glyph?: string }
		| { kind: 'table'; rows: readonly (readonly string[])[] }
		| { kind: 'result' | 'heading' | 'para' | 'item'; text: string };
</script>

<script lang="ts">
	let { lines }: { lines: readonly TerminalLine[] } = $props();
</script>

{#each lines as line, index (index)}
	<div class={['line', line.kind]}>
		{#if line.kind === 'tool'}
			<span class="dot">⏺</span>
			<b>{line.tool}</b>
			<span class="text arg">{line.text}</span>
		{:else if line.kind === 'result'}
			<span class="elbow">⎿</span>
			<span class="text">{line.text}</span>
		{:else if line.kind === 'say'}
			<span class="dot said">{line.glyph ?? '⏺'}</span>
			<span class="text">{line.text}</span>
		{:else if line.kind === 'table'}
			<span class="grid" style:--columns={line.rows[0]?.length ?? 1}>
				{#each line.rows as row, rowIndex (rowIndex)}
					{#each row as cell, cellIndex (cellIndex)}
						<span class={['cell', { head: rowIndex === 0 }]}>{cell}</span>
					{/each}
				{/each}
			</span>
		{:else}
			<span class="text">
				{#each line.text.split('`') as part, index (index)}
					{#if index % 2}
						<code>{part}</code>
					{:else}
						{part}
					{/if}
				{/each}
			</span>
		{/if}
	</div>
{/each}

<style>
	.line {
		display: flex;
		flex: none;
		min-height: 18px;
	}

	.tool,
	.result {
		white-space: nowrap;
	}

	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dot {
		flex: none;
		margin-right: 1ch;
		color: var(--term-ok);
	}

	.said,
	b {
		color: var(--term-fg);
	}

	b {
		flex: none;
		font-weight: 600;
	}

	.arg,
	.result {
		color: var(--term-dim);
	}

	.arg::before,
	.arg::after {
		color: var(--term-fg);
	}

	.arg::before {
		content: '(';
	}

	.arg::after {
		content: ')';
	}

	.elbow {
		flex: none;
		padding: 0 2ch;
		color: var(--term-faint);
	}

	.heading,
	.para,
	.item,
	.table {
		padding-left: 2ch;
		color: var(--term-fg);
	}

	.heading {
		margin-top: 6px;
		font-weight: 600;
	}

	.item::before {
		content: '-';
		flex: none;
		width: 2ch;
		color: var(--term-dim);
	}

	.grid {
		display: inline-grid;
		grid-template-columns: repeat(var(--columns), auto);
		margin: 4px 0;
		border-right: 1px solid var(--term-edge);
		border-bottom: 1px solid var(--term-edge);
		color: var(--term-dim);
		white-space: nowrap;
	}

	.cell {
		padding: 1px 1ch;
		border-top: 1px solid var(--term-edge);
		border-left: 1px solid var(--term-edge);
	}

	.head {
		color: var(--term-fg);
		font-weight: 600;
	}

	code {
		color: var(--term-pick);
		font: inherit;
	}
</style>
