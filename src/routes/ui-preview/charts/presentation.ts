import { formatValue, type ChartModel, type ChartRow } from '$lib/ui/charts/model';

/** Keep the exact fixture intact; only remove repeated value/evidence copy. */
export function chartRowDetail(row: ChartRow, unit: string) {
  const repeated = new Set([formatValue(row.value), formatValue(row.value, row.valueUnit ?? unit)]);
  return (row.detail ?? '').split(' · ').filter(part => {
    if (repeated.has(part.trim())) return false;
    return row.evidence === undefined || !new RegExp(`^${row.evidence} evidence (items|observations)$`, 'i').test(part.trim());
  }).join(' · ');
}

export function chartRowContext(row: ChartRow, unit: string) {
  return [
    chartRowDetail(row, unit),
    row.reference === undefined ? '' : `Reference ${formatValue(row.reference, row.referenceUnit ?? unit)}`,
    row.evidence === undefined ? '' : `${row.evidence} evidence items`,
  ].filter(Boolean).join(' · ');
}

export function chartRowSummary(row: ChartRow, model: Pick<ChartModel, 'unit' | 'series'>) {
  const unit = row.valueUnit ?? model.unit;
  const value = row.values?.length && model.series.length
    ? row.values.map((value, index) => `${model.series[index]?.name ?? `Series ${index + 1}`}: ${formatValue(value, model.unit)}`).join(' · ')
    : row.capacity === undefined ? formatValue(row.value, unit)
    : `${formatValue(row.value)} / ${formatValue(row.capacity, unit)}`;
  return [value, chartRowContext(row, model.unit)].filter(Boolean).join(' · ');
}
