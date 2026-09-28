export interface ChartDatum {
  label: string;
  value: number;
  href?: string;
  detail?: string;
  tone?: string;
}
export const chartTones = [
  '#f1f3f7',
  '#b7bbc2',
  '#858b94',
  '#626973',
  '#464d57',
  '#353b44',
  '#262c34',
];
export const chartValue = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
