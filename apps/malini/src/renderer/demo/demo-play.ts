export type DemoPlayMode = 'hero' | 'tour' | 'docs';

const play = new URLSearchParams(location.search).get('play');

export const DEMO_PLAY: DemoPlayMode | null =
	play === 'hero' || play === 'tour' || play === 'docs' ? play : null;
