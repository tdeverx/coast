export type ChartContext = 'P' | 'T' | 'S' | 'M';
export type ChartMedium = 'Benchmarks' | 'Screen' | 'Movies' | 'Shows' | 'Games' | 'Music';
export type ChartDataset = 'A' | 'B';
export interface ChartStyle {
  id: string;
  name: string;
  family: string;
  contexts: ChartContext[];
  variantIds: string[];
  sourceImage: string;
  knownApproximations: string[];
}
export interface ChartFixture {
  id: string;
  sourceId: string;
  context: ChartContext;
  variant: ChartDataset;
  title: string;
  supportedMediums: string[];
  semanticData: Record<string, unknown>;
  knownApproximations: string[];
}
