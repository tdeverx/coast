/** Equivalent orientation with no accumulated complete revolutions. */
export function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
export function coverFlipTarget(angle: number) {
  const turns = Math.round(angle / Math.PI);
  return { angle: turns * Math.PI, flip: Math.abs(turns) % 2 === 1 };
}
