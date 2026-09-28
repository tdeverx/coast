const blackFadeStops = [
  ['0%', 0], ['12%', 0.008], ['24%', 0.028], ['36%', 0.065], ['48%', 0.125],
  ['60%', 0.22], ['72%', 0.35], ['82%', 0.52], ['91%', 0.74], ['100%', 1],
] as const;

export function blackFadeGradient(edge: 'top' | 'bottom') {
  const direction = edge === 'bottom' ? 'to bottom' : 'to top';
  const stops = blackFadeStops.map(([position, opacity]) =>
    `${opacity === 0 ? 'transparent' : `rgb(0 0 0 / ${opacity})`} ${position}`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}
