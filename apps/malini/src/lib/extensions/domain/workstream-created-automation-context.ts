export type WorkstreamCreatedAutomationContext = Readonly<{
	task?: string;
	source?: Readonly<{
		provider: string;
		resourceId: string;
		title?: string;
		url?: string;
	}>;
}>;
