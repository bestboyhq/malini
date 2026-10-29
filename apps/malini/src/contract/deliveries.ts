export type ChatDeliveryStatus = 'waiting' | 'delivered' | 'failed';

export type ChatDelivery = Readonly<{
	id: string;
	sessionId: string;
	fromSessionId: string | null;
	status: ChatDeliveryStatus;
	runId: string | null;
	detail: string | null;
	createdAt: string;
	deliveredAt: string | null;
}>;

export type ChatDeliveryChangedEvent = Readonly<{ delivery: ChatDelivery }>;

export type ListChatDeliveriesArgs = Readonly<{ fromSessionId: string }>;

export type WorkstreamReportMedia = Readonly<{ src: string; label: string }>;

export type WorkstreamReport = Readonly<{
	workstreamId: string;
	runId: string;
	status: 'succeeded' | 'failed';
	outcome: string | null;
	needs: string | null;
	media: readonly WorkstreamReportMedia[];
}>;
