import { flushSync, mount, unmount } from 'svelte';
import BufferedStreamingMarkdown from './BufferedStreamingMarkdown.svelte';

export type BufferedStreamingMarkdownHarness = Readonly<{
	bufferedCharacters(): number;
	flush(): void;
	stop(): void;
}>;

export function mountBufferedStreamingMarkdown(text: string): BufferedStreamingMarkdownHarness {
	const host = document.createElement('div');
	document.body.append(host);
	const props = $state({ text, flush: false });
	const app = mount(BufferedStreamingMarkdown, { target: host, props });
	flushSync();
	return {
		bufferedCharacters: () =>
			Number(
				host.querySelector('[data-buffered-characters]')?.getAttribute('data-buffered-characters'),
			),
		flush(): void {
			props.flush = true;
			flushSync();
		},
		stop(): void {
			void unmount(app);
			host.remove();
		},
	};
}
