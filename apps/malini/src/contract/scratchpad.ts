export type ScratchpadArgs = Readonly<{ repositoryFullName: string }>;

export type SaveScratchpadArgs = ScratchpadArgs & Readonly<{ content: string }>;

export const SCRATCHPAD_CONTENT_MAX_LENGTH = 4_000_000;

export const REPOSITORY_FULL_NAME_MAX_LENGTH = 300;
