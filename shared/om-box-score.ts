export const isBoxBrokenReason = (
  rejectionReason: unknown,
  externalRejectionReason: unknown,
  boxBrokenReason: string,
): boolean =>
  rejectionReason === boxBrokenReason || externalRejectionReason === boxBrokenReason;

export interface BoxScoreAggregate {
  sum: number;
  measured: number;
}

export function boxAverageFromAggregate(
  aggregate: BoxScoreAggregate | null | undefined,
): { avgScore: number | null; measuredCount: number } {
  if (!aggregate || aggregate.measured <= 0) {
    return { avgScore: null, measuredCount: 0 };
  }
  return {
    avgScore: Math.round((aggregate.sum / aggregate.measured) * 10) / 10,
    measuredCount: aggregate.measured,
  };
}

export function matchesBoxScoreFilter(
  isBoxBroken: boolean,
  avgScore: number | null | undefined,
  enabled: boolean,
  maxScoreText: string,
): boolean {
  const hasLimit = maxScoreText.trim() !== "";
  if (!enabled && !hasLimit) return true;
  if (!isBoxBroken) return false;
  if (!hasLimit) return true;

  const maxScore = Number(maxScoreText);
  return Number.isFinite(maxScore) && avgScore != null && avgScore < maxScore;
}