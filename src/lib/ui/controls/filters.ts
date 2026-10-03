export type FilterGroup = {
  label: string;
  value: string;
  options: {value: string; label: string}[];
  change: (value: string) => void;
};
