import { describe, expect, it } from 'vitest';
import { updateReleases } from './update-releases';

const generatedNote = (...items: string[]): string =>
	`<h2>What&#39;s Changed</h2>\n<ul>\n${items.map((item) => `<li>${item}</li>`).join('\n')}\n</ul>\n<p><strong>Full Changelog</strong>: <a href="https://github.com/acme/app/compare/v1.1.0...v1.2.0"><tt>v1.1.0...v1.2.0</tt></a></p>`;

const credit = (number: number): string =>
	` by <a class="user-mention notranslate" href="https://github.com/octo">@octo</a> in <a class="issue-link js-issue-link" href="https://github.com/acme/app/pull/${number}">#${number}</a>`;

describe('updateReleases', () => {
	it('reads what each release changed from GitHub generated notes', () => {
		expect(
			updateReleases([
				{
					version: '1.2.0',
					note: generatedNote(
						`feat(chat): let a turn&#39;s report &amp; its &lt;diff&gt; share a card${credit(12)}`,
						`docs: rename the guide${credit(13)}`,
						`fix!: stop the clock from drifting${credit(14)}`,
					),
				},
				{
					version: '1.1.1',
					note: generatedNote(`perf(git): read status once per tick${credit(11)}`),
				},
				{
					version: '1.1.0',
					note: generatedNote(
						'<a href="https://github.com/octo">@octo</a> made their first contribution',
					),
				},
				{ version: '1.0.9', note: null },
			]),
		).toEqual([
			{
				version: '1.2.0',
				changes: [
					{ kind: 'feature', summary: "Let a turn's report & its <diff> share a card" },
					{ kind: 'fix', summary: 'Stop the clock from drifting' },
				],
			},
			{ version: '1.1.1', changes: [{ kind: 'perf', summary: 'Read status once per tick' }] },
			{ version: '1.1.0', changes: [] },
			{ version: '1.0.9', changes: [] },
		]);
	});

	it('has nothing to list when the notes cover only the latest release', () => {
		expect(updateReleases('<p>Only the latest</p>')).toEqual([]);
		expect(updateReleases(null)).toEqual([]);
	});
});
