export const isBoxBrokenReason = (
  rejectionReason: unknown,
  externalRejectionReason: unknown,
  boxBrokenReason: string,
): boolean =>
  rejectionReason === boxBrokenReason || externalRejectionReason === boxBrokenReason;

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