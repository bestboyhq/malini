import { BRIDGE_AGENT_CONTEXT_PATH } from './protocol-contract.generated';

export type LeadDecisionPicture = Readonly<{ workstreamId: string; path: string }>;

export type LeadDecisionOption = Readonly<{
	label: string;
	note: string | null;
	picture: LeadDecisionPicture | null;
}>;

export type LeadDecisionDecider = 'you' | 'lead';

export type LeadDecisionAnswer = Readonly<{
	option: number;
	by: LeadDecisionDecider;
	reason: string | null;
	at: string;
}>;

export type LeadDecision = Readonly<{
	id: string;
	sessionId: string;
	workstreamId: string;
	topic: string;
	question: string;
	why: string | null;
	options: readonly LeadDecisionOption[];
	recommended: number;
	meanwhile: string | null;
	askedAt: string;
	answer: LeadDecisionAnswer | null;
}>;

export type LeadDecisionChangedEvent = Readonly<{ decision: LeadDecision }>;

export type ListLeadDecisionsArgs = Readonly<{ sessionId: string }>;

export type AnswerLeadDecisionArgs = Readonly<{
	decisionId: string;
	option: number;
	reason?: string;
}>;

export const LEAD_PLAN_PATH = `${BRIDGE_AGENT_CONTEXT_PATH}/plan.md`;
