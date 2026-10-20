import type { SessionId } from './session';

export type TranscriptPresentation = Readonly<{
	workstreamId: string;
	sessionId: SessionId;
}>;
