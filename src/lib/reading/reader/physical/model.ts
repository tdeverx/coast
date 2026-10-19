import type * as THREE from 'three';
export type BindingKind = 'comic' | 'book';
export type PageGrab = {
  u?: number;
  v?: number;
  pullY?: number;
  height?: number;
};
export type Dimensions = {
  width: number;
  height: number;
};
export type Point = {
  x: number;
  y: number;
  z: number;
};
export type Rotation = [
  number,
  number,
  number
];
export type CameraPose = {
  position: Point;
  zoom: number;
  rotation: Rotation;
};
export type FocusAnchor = {
  pose: CameraPose;
  blend?: number;
  progress?: number;
};
export type FocusSession = {
  from: CameraPose;
  side: number;
  opened: boolean;
  zoomingOut: boolean;
  progress: number;
  anchor?: FocusAnchor;
};
export type PageOptions = Dimensions & {
  side?: number;
  curl?: number;
  restCurl?: number;
  corner?: number;
  bendScale?: number;
  stiffness?: number;
  grab?: PageGrab;
};
export type PhysicalState = {
  opened: boolean;
  index: number;
  busy: boolean;
  cascadeDirection: number;
  canCascade: boolean;
  curlingPages: number;
  backCover: boolean;
  focused: boolean;
  focusedPage: number | null;
  readingCover: boolean;
};
export type PhysicalOptions = {
  count: number;
  getPage(index: number): Promise<HTMLCanvasElement>;
  modelKind?: BindingKind;
  thickness?: number;
  entrance?: boolean;
  title?: string;
  controlled?: () => boolean;
  onDismiss?: () => void;
  onState?: (state: PhysicalState) => void;
  onError?: (error: unknown) => void;
};
export type PageMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
export type CascadeTurn = {
  from: number;
  target: number;
  direction: number;
  grab?: PageGrab;
  ready: boolean;
  start: number | null;
  progress: number;
  mesh?: PageMesh;
  maps?: THREE.Texture[];
};
export type BookMaterials = Record<'edges' | 'ivory' | 'boardEdge' | 'frontInside' | 'backInside' | 'frontOutside' | 'backOutside' | 'left' | 'right' | 'staple', THREE.Material> & {
  underLeft?: THREE.Material[];
  underRight?: THREE.Material[];
};
export type BookPose = {
  index?: number;
  stackIndex?: number;
  leftPage?: number;
  rightPage?: number;
  kind?: BindingKind;
  thickness?: number;
  frontFold?: number;
  backFold?: number;
  opening?: boolean;
  curl?: number;
  corner?: number;
  layerCurls?: readonly number[];
  coverCurl?: number;
  coverStiffness?: number;
  grab?: PageGrab;
  weightMultipliers?: readonly number[];
};
