export type DemoPlayMode = 'tour' | 'setup' | 'docs' | 'first-run';

const PLAYS: readonly DemoPlayMode[] = ['tour', 'setup', 'docs', 'first-run'];

const play = new URLSearchParams(location.search).get('play');

export const DEMO_PLAY: DemoPlayMode | null = PLAYS.find((mode) => mode === play) ?? null;
