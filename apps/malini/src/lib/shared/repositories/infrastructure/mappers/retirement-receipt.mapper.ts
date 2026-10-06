import type { SavedWorkstreamWork } from '$shared/repositories/domain/workstream-retirement';

type RawRetirementReceipt = Readonly<{
	savedWork: Readonly<{ ref: string; uncommitted: boolean; commits: number }> | null;
}>;

export class RetirementReceiptMapper {
	static savedWork(raw: RawRetirementReceipt | null | undefined): SavedWorkstreamWork | null {
		const saved = raw?.savedWork ?? null;
		if (!saved || typeof saved.ref !== 'string' || saved.ref.length === 0) return null;
		return { ref: saved.ref, uncommitted: saved.uncommitted === true, commits: saved.commits || 0 };
	}
}
