export type TranscriptSettleGate = {
	isSettled(): boolean;
	resettleTranscript(): void;
	destroy(): void;
};

export function createTranscriptSettleGate(): TranscriptSettleGate {
	let transcriptSettled = false;
	let settleFrame: number | null = null;

	function resettleTranscript(): void {
		transcriptSettled = false;
		if (settleFrame !== null) cancelAnimationFrame(settleFrame);
		settleFrame = requestAnimationFrame(() => {
			settleFrame = null;
			transcriptSettled = true;
		});
	}

	return {
		isSettled: () => transcriptSettled,
		resettleTranscript,
		destroy(): void {
			if (settleFrame !== null) cancelAnimationFrame(settleFrame);
			settleFrame = null;
		},
	};
}
