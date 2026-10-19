import type { BindingKind, PageGrab, PhysicalOptions, CameraPose, FocusSession, PageMesh } from './model.ts';
import { wrapAngle, coverFlipTarget } from './orientation.ts';
import { finalSpreadIndex, interiorPage, spreadForPage } from './page-layout.ts';
import { dragTurns, turnEase } from './turn-gesture.ts';
import { PageCascade } from './turn-cascade.ts';
import { underPageIndex, reversePageIndex, spreadSheetPages, nearbyPages, retainedPages, sheetPitch, layerCurl, turningLayer, defaultCurlTargets, defaultWeightMultipliers, turningCurlScale, NeighborPreloader } from './page-stack.ts';
import { pageFrame, frameZoomDistance, reframeSurface, clampScroll, swipeDirection, anchoredPosition, manualFocusProgress, manualFocusZoom, manualFocusPose, canRetargetFocus, advanceFocusBlend, focusReturnAnchor, recoverFocusProgress, wheelFocusMode, readingTurnBlend, readingStep } from './view.ts';
import * as THREE from 'three';
import { sampleLeaf, layerRestCurl, pageMeshSegments, comicThicknessPercent, hingeSample, gutterWeight, maxPageCurl, pageDimensions, paperEdgeLinesPerTile } from './page-geometry.ts';
import { createBookModel, bindingDimensions, stackDepths } from './book-model.ts';
import { bindReversePage } from './materials.ts';
import { paperFinish, coverFinish, curlBookRotation, comicShadowNormalBias } from './lighting.ts';
import { defaultViewTilts, bookEntrancePose } from './view-motion.ts';
const ease = turnEase;
// More fixed PCF samples keep broad shadows soft without VSM's receiver-as-caster
// behaviour, which makes the large shadow-catching plane interfere with thin leaves.
const softShadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment.replace(/shadow = \([\s\S]*?\) \* 0\.2;/, `shadow = (${Array.from({ length: 16 }, (_, i) => `texture(shadowMap, vec3(shadowCoord.xy + vogelDiskSample(${i}, 16, 0.0) * radius, shadowCoord.z))`).join(' + ')}) / 16.0;`);
function softenShadows(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', softShadowChunk);
}
const blank = () => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 960;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f1ecdf';
  x.fillRect(0, 0, c.width, c.height);
  return c;
};
/** One persistent comic or hardback binding with independently hinged covers. */
export async function createRenderer(host: HTMLElement, options: PhysicalOptions) {
  const { count, getPage, onState = () => {
  }, onError = () => {
  } } = options;
  let disposed = false, opened = false, busy = Boolean(options.entrance), index = 1, resumeIndex = 1, curl = defaultCurlTargets[0], tilt: number = defaultViewTilts.open, closedTilt: number = defaultViewTilts.closed, zoom = 1, frame = 0, backClosed = false;
  let entrancePending = Boolean(options.entrance);
  let view = 'inspect', focusedSide = 1, readingY = 0, manualFraming = false, spreadAmount = 0;
  let lastTouch: {
    time: number;
    x: number;
    y: number;
  } | null | undefined;
  let focusScroll: FocusSession | null | undefined;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  camera.position.set(0, -.1, 11);
  const book = new THREE.Group();
  book.visible = !entrancePending;
  scene.add(book);
  const paper = blank();
  const [coverCanvas, lastCanvas] = await Promise.all([0, count - 1].map(getPage));
  // Validate GPU setup before allocating geometry, materials or textures.
  const webgl = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  const cleanups: (() => void)[] = [];
  const animations = new Set<(complete: boolean) => void>();
  cleanups.push(() => {
    for (const finish of [...animations]) finish(false);
  });
  function dispose() {
    if (disposed)
      return;
    disposed = true;
    for (const cleanup of cleanups.reverse())
      cleanup();
    cleanups.length = 0;
  }
  // Register construction ownership before allocating the rest of the scene.
  // The same lifetime handles a rejected factory and an ordinary close.
  cleanups.push(() => webgl.forceContextLoss(), () => {
    webgl.dispose();
    webgl.domElement.remove();
  }, () => {
    clearTimeout(clickTimer);
    cancelAnimationFrame(frame);
  }, () => {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry)
        geometries.add(mesh.geometry);
      if (mesh.material)
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  });
  const events = new AbortController();
  cleanups.push(() => events.abort());
  try {
  const height = 4.25, width = height * coverCanvas.width / coverCanvas.height;
  let modelKind: BindingKind = options.modelKind === 'book' ? 'book' : 'comic';
  let thicknessPercent = modelKind === 'comic' ? comicThicknessPercent(count) : (options.thickness ?? .6);
  let frontFold = 1, backFold = 0, openingCover = false;
  let stackIndex: number | undefined, turnSurfaces: [
    number,
    number
  ] | undefined, loadingSpread: number | undefined;
  const layerCurls = defaultCurlTargets.slice(1, 3);
  let coverCurl = defaultCurlTargets[3], paperStiffness = .4, coverStiffness = .6;
  const weightMultipliers = [...defaultWeightMultipliers];
  const cascade = new PageCascade(count);
  let cascadeFrame = 0, cascadeVersion = 0;
  cleanups.push(() => {
    ++cascadeVersion;
    cancelAnimationFrame(cascadeFrame);
    cascade.clear();
  });
  let cascadeCamera: {
    from: CameraPose;
    start: number;
    target: number;
  } | undefined;
  let cascadeFocus: number | undefined;
  const thickness = () => bindingDimensions(modelKind, height, thicknessPercent).totalDepth;
  let surface: {
    prepare(textures: THREE.Texture[]): void;
    canvas: HTMLCanvasElement;
    render(): void;
    resize(w: number, h: number): void;
  };
  let gesture: ReturnType<typeof dragTurns>;
  let automaticGrab: PageGrab | undefined;
  const textures = new Map<number, THREE.Texture>(), textureLoads = new Map<number, Promise<THREE.Texture>>();
  cleanups.push(() => textures.forEach(texture => texture.dispose()));
  function texture(canvas: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  const emptyTexture = texture(paper);
  cleanups.push(() => emptyTexture.dispose());
  async function pageTexture(i: number): Promise<THREE.Texture> {
    if (i < 0 || i >= count)
      return emptyTexture;
    if (textures.has(i))
      return textures.get(i)!;
    if (!textureLoads.has(i))
      textureLoads.set(i, (async () => {
        const canvas = await getPage(i);
        if (disposed)
          throw new DOMException('Renderer disposed.', 'AbortError');
        const t = texture(canvas);
        surface?.prepare?.([t]);
        textures.set(i, t);
        return t;
      })().finally(() => textureLoads.delete(i)));
    return textureLoads.get(i)!;
  }
  for (const [page, canvas] of [[0, coverCanvas], [count - 1, lastCanvas]] as const) {
    if (!textures.has(page))
      textures.set(page, texture(canvas));
  }
  const cover = textures.get(0)!;
  const last = textures.get(count - 1)!;
  const edgeCanvas = document.createElement('canvas');
  edgeCanvas.width = 16;
  edgeCanvas.height = paperEdgeLinesPerTile * 4;
  const edge = edgeCanvas.getContext('2d')!;
  edge.fillStyle = '#ece7d9';
  edge.fillRect(0, 0, 16, edgeCanvas.height);
  for (let y = 2; y < edgeCanvas.height; y += 4) {
    edge.fillStyle = y % 8 ? '#d4cebf' : '#e1dacb';
    edge.fillRect(0, y, 16, 1);
  }
  const edges = texture(edgeCanvas);
  cleanups.push(() => edges.dispose());
  edges.wrapS = edges.wrapT = THREE.RepeatWrapping;
  const material = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: paperFinish.roughness, metalness: 0, side: THREE.DoubleSide });
  const edgeMaterial = material(edges);
  const ivory = new THREE.MeshStandardMaterial({ color: '#e3ddcf', roughness: 1 });
  const coverMaterial = (map: THREE.Texture) => {
    const m = new THREE.MeshPhysicalMaterial({ map, ...coverFinish, shadowSide: THREE.DoubleSide });
    m.onBeforeCompile = softenShadows;
    return m;
  };
  const coverFront = coverMaterial(cover), coverBack = coverMaterial(last);
  const pageMaterial = (map: THREE.Texture) => {
    const m = material(map);
    m.vertexColors = true;
    m.shadowSide = THREE.DoubleSide;
    m.onBeforeCompile = softenShadows;
    return m;
  };
  const sheetMaterial = (map: THREE.Texture) => {
    const m = pageMaterial(map);
    bindReversePage(m, emptyTexture);
    return m;
  };
  const insideMaterial = (map: THREE.Texture) => {
    const m = pageMaterial(map);
    m.side = THREE.FrontSide;
    m.onBeforeCompile = softenShadows;
    return m;
  };
  const frontInside = insideMaterial(emptyTexture);
  const backInside = insideMaterial(emptyTexture);
  async function insideCover(back: boolean) {
    const material = back ? backInside : frontInside;
    const map = await pageTexture(back ? Math.max(0, count - 2) : Math.min(1, count - 1));
    if (disposed) return;
    material.map = map;
    material.needsUpdate = true;
  }
  const stapleMaterial = new THREE.MeshStandardMaterial({ color: '#adb0ac', metalness: .65, roughness: .45 });
  const boardEdge = new THREE.MeshStandardMaterial({ color: '#c5bda9', roughness: .8 });
  const underMaterial = (layer: number) => {
    const m = sheetMaterial(emptyTexture);
    m.polygonOffset = true;
    m.polygonOffsetFactor = 0;
    m.polygonOffsetUnits = layer * 2;
    return m;
  };
  const binding = createBookModel({ width, height, count, materials: { edges: edgeMaterial, ivory, boardEdge, frontInside, backInside, frontOutside: coverFront, backOutside: coverBack, left: sheetMaterial(emptyTexture), right: sheetMaterial(emptyTexture), underLeft: [underMaterial(1), underMaterial(2)], underRight: [underMaterial(1), underMaterial(2)], staple: stapleMaterial } });
  const { group: bindingRoot, frontCover, backCover, left, right } = binding;
  book.add(bindingRoot);
  function makePage(side: number, map: THREE.Texture) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, pageMeshSegments.width, pageMeshSegments.height), sheetMaterial(map));
    mesh.frustumCulled = false;
    mesh.userData.side = side;
    mesh.userData.baseUV = new Float32Array(mesh.geometry.attributes.uv.array);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count * 3).fill(1), 3));
    bindingRoot.add(mesh);
    return mesh;
  }
  function turningPage() {
    const mesh = makePage(1, emptyTexture);
    mesh.visible = false;
    mesh.userData.reverse = mesh.material.userData.reversePage;
    return mesh;
  }
  const turning = turningPage(), reverseUniform = turning.userData.reverse;
  // Reuse a small fixed pool; repeated clicks do not allocate more meshes.
  const cascadePages = Array.from({ length: cascade.limit }, turningPage);
  function deform(mesh: PageMesh, turn = 0) {
    const positions = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv, baseUV = mesh.userData.baseUV;
    const side = mesh.userData.side;
    const size = pageDimensions(modelKind, width, height);
    const from = mesh.userData.record?.from ?? index, level = turningLayer(from, side, turn, stackIndex ?? from), paperDepth = bindingDimensions(modelKind, height, thicknessPercent).depth;
    const depths = stackDepths(stackIndex ?? from, count, paperDepth), weight = turningCurlScale(side, turn, paperDepth > 0 ? depths.left / paperDepth : .5, weightMultipliers);
    const restCurl = layerRestCurl(layerCurl(level, [curl, ...layerCurls]) * weight);
    const depth = sheetPitch(count, paperDepth) * level;
    const grab = mesh.userData.record?.grab ?? (mesh === turning ? (gesture?.grab() ?? automaticGrab) : undefined);
    for (let i = 0; i < positions.count; i++) {
      const u = hingeSample(side > 0 ? baseUV[i * 2] : 1 - baseUV[i * 2]), v = baseUV[i * 2 + 1];
      uv.setX(i, side > 0 ? u : 1 - u);
      const p = sampleLeaf(u, v, turn, { ...size, side, curl: .45, restCurl, stiffness: paperStiffness, grab });
      // Start and land in the exact nested-sheet pose. Extra clearance exists
      // only during the curl, so joining a cascade cannot pop the sheet upward.
      positions.setXYZ(i, p.x, p.y, p.z + .003 + gutterWeight(u) * (-depth + Math.sin(Math.PI * turn) * (.006 + (mesh.userData.layer || 0) * .001)));
      const shade = 1 - .13 * Math.exp(-u * 32);
      mesh.geometry.attributes.color.setXYZ(i, shade, shade, shade);
    }
    positions.needsUpdate = uv.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.ShadowMaterial({ opacity: .24, depthWrite: false, side: THREE.DoubleSide }));
  floor.material.onBeforeCompile = softenShadows;
  floor.position.z = -.3;
  floor.receiveShadow = true;
  scene.add(floor);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sx = shadowCanvas.getContext('2d')!, gradient = sx.createRadialGradient(64, 64, 3, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(32,30,24,.14)');
  gradient.addColorStop(.55, 'rgba(32,30,24,.06)');
  gradient.addColorStop(1, 'rgba(32,30,24,0)');
  sx.fillStyle = gradient;
  sx.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  cleanups.push(() => shadowTexture.dispose());
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(width + 1.1, height + .9), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  contact.position.set(.06, -.08, -.31);
  scene.add(contact);
  const ambient = new THREE.HemisphereLight(0xf3f6ff, 0x948b7d, 1.3);
  ambient.position.set(0, 0, 8);
  scene.add(ambient);
  const fill = new THREE.DirectionalLight(0xdde8ff, .65);
  fill.position.set(5, -1, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffedcf, .85);
  rim.position.set(1, 4, -3);
  scene.add(rim);
  const light = new THREE.DirectionalLight(0xfff3df, 3.0);
  light.position.set(-3.5, 5, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = light.shadow.camera.bottom = -5;
  light.shadow.camera.right = light.shadow.camera.top = 5;
  light.shadow.camera.near = .5;
  light.shadow.camera.far = 22;
  light.shadow.bias = -.00008;
  light.shadow.normalBias = comicShadowNormalBias;
  light.shadow.radius = 12;
  light.shadow.intensity = .75;
  scene.add(light);
  cleanups.push(() => light.shadow.dispose());
  {
    const renderer = webgl;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.append(renderer.domElement);
    surface = { prepare: (ts: THREE.Texture[]) => ts.forEach(t => renderer.initTexture(t)), canvas: renderer.domElement, render: () => renderer.render(scene, camera), resize: (w: number, h: number) => renderer.setSize(w, h) };
  }
  surface.canvas.setAttribute('aria-label', options.title ?? 'Physical book reader');
  let rotX = -closedTilt * Math.PI / 180, rotY = -.28, rotZ = -.07;
  const currentTilt = () => opened ? tilt : closedTilt;
  const facingAxis = new THREE.Vector3(0, 0, 1), shadowNormal = new THREE.Vector3(), shadowOffset = new THREE.Vector3();
  function updateBinding() {
    const leftPage = turnSurfaces?.[0] ?? index, rightPage = turnSurfaces?.[1] ?? index + 1;
    for (const page of [left, right, ...binding.underPages]) {
      const { side, layer } = page.userData, top = side < 0 ? leftPage : rightPage, number = layer ? underPageIndex(top, side, layer, count) : top, reverse = reversePageIndex(number, side, count);
      const map = textures.get(number), back = textures.get(reverse), ready = Boolean(map && back);
      page.userData.loadedPage = ready ? number : -1;
      page.userData.loadedReversePage = ready ? reverse : -1;
      page.userData.textureReady = reverse < 0 || ready;
      if (ready) {
        if (page.material.map !== map) {
          page.material.map = map!;
          page.material.needsUpdate = true;
        }
        page.material.userData.reversePage.value = back;
      }
    }
    binding.update({ index, stackIndex: stackIndex ?? index, leftPage, rightPage, kind: modelKind, thickness: thicknessPercent, frontFold, backFold, opening: openingCover, curl, layerCurls, coverCurl, coverStiffness, weightMultipliers, grab: busy ? (gesture?.grab() ?? automaticGrab) : undefined });
  }
  function coverSurface(world = false) {
    updateBinding();
    book.rotation.set(rotX, rotY, rotZ);
    book.updateMatrixWorld(true);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(book.quaternion);
    const positive = !world || normal.dot(camera.position.clone().sub(book.position)) >= 0;
    const mesh = positive !== backClosed ? frontCover : backCover, bounds = mesh.geometry.boundingBox!;
    const center = bounds.getCenter(new THREE.Vector3());
    center.z = positive ? bounds.max.z : bounds.min.z;
    if (world)
      mesh.localToWorld(center);
    else
      center.add(bindingRoot.position);
    return { width: bounds.max.x - bounds.min.x, height: bounds.max.y - bounds.min.y, center };
  }
  const controlInset = () => Math.min(.3, 72 / Math.max(1, host.clientHeight));
  function readingFrame(side = focusedSide, atIndex = index) {
    if (opened) {
      const insideCover = side < 0 ? atIndex === 1 : atIndex + 1 === count - 2;
      const size = insideCover ? { width, height } : pageDimensions(modelKind, width, height);
      return { ...pageFrame(size.width, size.height, camera.aspect, 0, controlInset()), ...size, centerX: side * size.width / 2 };
    }
    const surface = coverSurface();
    return { ...pageFrame(surface.width, surface.height, camera.aspect, surface.center.z, controlInset()), width: surface.width, height: surface.height, centerX: surface.center.x };
  }
  function render() {
    if (!disposed && !document.hidden) {
      updateBinding();
      rotX = wrapAngle(rotX);
      rotY = wrapAngle(rotY);
      rotZ = wrapAngle(rotZ);
      book.rotation.set(rotX, rotY, rotZ);
      book.updateMatrixWorld(true);
      // One receiver for every book state. Choose the visible-facing normal so
      // it stays behind the book when inspecting the outside of either cover.
      shadowNormal.copy(facingAxis).applyQuaternion(book.quaternion);
      if (shadowNormal.z < 0)
        shadowNormal.negate();
      floor.quaternion.setFromUnitVectors(facingAxis, shadowNormal);
      floor.position.copy(book.position).addScaledVector(shadowNormal, -thickness() - .14);
      contact.quaternion.copy(floor.quaternion);
      shadowOffset.set(.06, -.08, -.01).applyQuaternion(floor.quaternion);
      contact.position.copy(floor.position).add(shadowOffset);
      contact.scale.x = 1 + .8 * spreadAmount;
      surface.render();
    }
  }
  function redraw() {
    if (!frame && !disposed && !document.hidden)
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
  }
  const isReading = () => view === 'page';
  const cameraPose = (): CameraPose => ({ position: camera.position.clone(), zoom: camera.zoom, rotation: [rotX, rotY, rotZ] });
  function focusMotion(from: CameraPose, position: THREE.Vector3, t: number) {
    camera.position.copy(from.position).lerp(position, t);
    zoom = camera.zoom = from.zoom + (1 - from.zoom) * t;
    camera.updateProjectionMatrix();
    rotX = from.rotation[0] * (1 - t);
    rotY = from.rotation[1] * (1 - t);
    rotZ = from.rotation[2] * (1 - t);
  }
  function openingCamera(from: CameraPose, destination: THREE.Vector3, t: number) {
    camera.position.copy(from.position).lerp(destination, t);
    zoom = camera.zoom = from.zoom + (1 - from.zoom) * t;
    camera.updateProjectionMatrix();
    rotX = from.rotation[0] * (1 - t) - tilt * Math.PI / 180 * t;
    rotY = from.rotation[1] * (1 - t);
    rotZ = from.rotation[2] * (1 - t);
  }
  function readingMotion(from: CameraPose, t: number, side: number | null, atIndex = index) {
    const middle = spreadPosition(), frame = readingFrame(side ?? focusedSide, atIndex), out = ease(Math.min(1, t / .35)), inside = readingTurnBlend(t);
    const closing = side === null, destination = closing ? spreadPosition(false) : new THREE.Vector3(frame.centerX, frame.limit, frame.distance);
    camera.position.copy(from.position).lerp(middle, out).lerp(destination, inside);
    zoom = camera.zoom = from.zoom + (1 - from.zoom) * out;
    camera.updateProjectionMatrix();
    [rotX, rotY, rotZ] = curlBookRotation(from.rotation, t, closing, closedTilt);
    if (t === 1)
      readingY = frame.limit;
  }
  function readingBounds() {
    const frame = readingFrame();
    const visibleHeight = frame.visibleHeight / camera.zoom;
    return { ...frame, visibleHeight, limit: Math.max(0, (frame.height - visibleHeight * (1 - 2 * frame.inset)) / 2) };
  }
  function spreadPosition(isOpen = opened) {
    const fov = Math.tan(35 * Math.PI / 360);
    return new THREE.Vector3(0, -.1, Math.max((height + .95) / (2 * fov * (1 - 2 * controlInset())), (isOpen && count > 1 ? width * 2 + .6 : width + 1) / (2 * fov * camera.aspect)));
  }
  function fit() {
    focusScroll = null;
    manualFraming = false;
    zoom = 1;
    camera.zoom = 1;
    const rect = host.getBoundingClientRect();
    camera.aspect = rect.width / Math.max(1, rect.height);
    if (isReading()) {
      const frame = readingFrame();
      readingY = clampScroll(readingY, frame.limit);
      camera.position.set(frame.centerX, readingY, frame.distance);
      camera.updateProjectionMatrix();
      redraw();
      return;
    }
    camera.position.copy(spreadPosition());
    camera.updateProjectionMatrix();
    redraw();
  }
  function resize() {
    const { width: w, height: h } = host.getBoundingClientRect();
    surface.resize(Math.max(1, w), Math.max(1, h));
    fit();
  }
  const observer = new ResizeObserver(resize);
  cleanups.push(() => observer.disconnect());
  observer.observe(host);
  resize();
  function notify() {
    if (busy) {
      if (!manualFraming || view !== 'spread')
        focusScroll = null;
      clearTimeout(clickTimer);
    }
    if (opened)
      resumeIndex = index;
    if (!disposed)
      onState({ opened, index, busy, cascadeDirection: cascade.direction, canCascade: cascade.available, curlingPages: cascade.records.filter(record => record.start !== null).length, backCover: backClosed, focused: view !== 'inspect', focusedPage: isReading() && opened ? focusedSide : null, readingCover: isReading() && !opened });
  }
  async function animate(duration: number, step: (progress: number) => void) {
    if (reduced || document.hidden || duration === 0) {
      step(1);
      render();
      return;
    }
    await new Promise<void>(resolve => {
      const start = performance.now();
      let pending = 0, finished = false;
      const finish = (complete: boolean) => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(pending);
        animations.delete(finish);
        if (complete && !disposed) {
          step(1);
          render();
        }
        resolve();
      };
      animations.add(finish);
      function tick(now: number) {
        if (disposed) return finish(false);
        const t = Math.min(1, (now - start) / duration);
        step(ease(t));
        render();
        if (t < 1) pending = requestAnimationFrame(tick);
        else finish(false);
      }
      pending = requestAnimationFrame(tick);
    });
  }
  function trim() {
    const keep = retainedPages(count, [index, loadingSpread, turnSurfaces?.[0], turnSurfaces ? turnSurfaces[1] - 1 : undefined, ...cascade.records.flatMap(record => [record.from, record.target])]);
    for (const page of preloader.wanted)
      keep.add(page);
    for (const [i, t] of textures)
      if (!keep.has(i)) {
        t.dispose();
        textures.delete(i);
      }
  }
  const preloader = new NeighborPreloader({ load: pageTexture, has: i => textures.has(i), onLoad: () => {
      trim();
      redraw();
    } });
  cleanups.push(() => preloader.stop());
  const warmNeighbors = () => {
    if (entrancePending || disposed) return;
    const work = preloader.warm(nearbyPages(cascade.busy ? cascade.reserved : index, count));
    trim();
    return work;
  };
  const insideTexture = (i: number) => pageTexture(count === 1 ? 0 : interiorPage(i, count));
  function previewTextures(atIndex: number) {
    return Promise.all(spreadSheetPages(atIndex, count).map(pageTexture));
  }
  async function spread(previews = true) {
    const [a, b] = await Promise.all([insideTexture(index), insideTexture(index + 1), previews ? previewTextures(index) : undefined]);
    if (disposed)
      return;
    left.material.map = a;
    right.material.map = b;
    left.material.needsUpdate = right.material.needsUpdate = true;
    trim();
    warmNeighbors();
  }
  async function enter(page = 2) {
    if (!entrancePending || disposed)
      return;
    view = 'spread';
    busy = true;
    notify();
    try {
      index = spreadForPage(page, count);
      resumeIndex = index;
      focusedSide = Number(page) - 1 === index ? -1 : 1;
      camera.position.copy(spreadPosition());
      const travel = (2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360) + height) / 2 + .5;
      const draw = (t: number) => {
        const pose = bookEntrancePose(t, travel, closedTilt);
        book.position.y = pose.y;
        [rotX, rotY, rotZ] = pose.rotation;
      };
      draw(0);
      book.visible = true;
      render();
      // The closed outside covers are sufficient for the entrance. Required
      // opening faces load alongside its motion; speculation starts afterwards.
      await Promise.all([animate(1400, draw), insideCover(false), spread(false)]);
    }
    catch (error) {
      opened = false;
      frontFold = 1;
      backFold = 0;
      spreadAmount = 0;
      rotX = -closedTilt * Math.PI / 180;
      rotY = rotZ = 0;
      onError(error);
    }
    finally {
      entrancePending = false;
      openingCover = false;
      book.position.y = 0;
      book.visible = true;
      busy = false;
      warmNeighbors();
      notify();
      redraw();
    }
  }
  async function leave() {
    if (disposed || entrancePending) return;
    if (opened) await closeFront();
    if (disposed) return;
    if (view !== 'spread' || manualFraming || camera.zoom !== 1 || backClosed) await focusSpread();
    if (disposed) return;
    preloader.stop();
    busy = true;
    notify();
    const travel = (2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360) + height) / 2 + .5;
    await animate(1400, t => {
      const pose = bookEntrancePose(1 - t, travel, closedTilt);
      book.position.y = pose.y;
      [rotX, rotY, rotZ] = pose.rotation;
    });
    book.visible = false;
  }
  function closedSide(back: boolean) {
    if (back === backClosed)
      return;
    // Both covers remain attached. Re-express the same closed object from the
    // other spine side, cancelling that half-turn in the inspection rotation.
    rotY = wrapAngle(rotY + (back ? -Math.PI : Math.PI));
    backClosed = back;
    frontFold = back ? 0 : 1;
    backFold = back ? 1 : 0;
    index = back ? finalSpreadIndex(count) : 1;
    warmNeighbors();
  }
  async function open(page?: number, { reading = isReading(), grab }: {
    reading?: boolean;
    grab?: PageGrab;
  } = {}): Promise<void> {
    if (busy || disposed)
      return;
    if (opened)
      return page === undefined ? fit() : goToPage(page);
    return openCover(backClosed, page ?? (backClosed ? finalSpreadIndex(count) + 1 : resumeIndex + 1), reading, grab);
  }
  async function openCover(back: boolean, page: number | undefined, reading: boolean, grab?: PageGrab): Promise<void> {
    const readingStart = cameraPose(), previousView = view, keepCamera = !reading && manualFraming;
    const startIndex = index;
    view = 'spread';
    automaticGrab = grab;
    openingCover = true;
    busy = true;
    notify();
    try {
      index = page === undefined ? (back ? finalSpreadIndex(count) : 1) : spreadForPage(page, count);
      await Promise.all([insideCover(back), spread()]);
      if (disposed)
        return;
      const from = [wrapAngle(rotX), wrapAngle(rotY), wrapAngle(rotZ)];
      if (!reading && previousView === 'inspect')
        await animate(300, (t: number) => {
          rotX = from[0] * (1 - t) - closedTilt * Math.PI / 180 * t;
          rotY = from[1] * (1 - t);
          rotZ = from[2] * (1 - t);
        });
      const openingStart = cameraPose();
      opened = true;
      const destination = spreadPosition(), insideSide = back ? 1 : -1;
      const committed = await gesture.animate(850, (t: number) => {
        frontFold = back ? 0 : 1 - t;
        backFold = back ? 1 - t : 0;
        spreadAmount = t;
        if (reading)
          readingMotion(readingStart, t, insideSide);
        else if (!keepCamera)
          openingCamera(openingStart, destination, t);
        render();
      }, animate);
      if (!committed) {
        opened = false;
        index = startIndex;
        frontFold = back ? 0 : 1;
        backFold = back ? 1 : 0;
        spreadAmount = 0;
        view = previousView;
        camera.position.copy(readingStart.position);
        zoom = camera.zoom = readingStart.zoom;
        camera.updateProjectionMatrix();
        [rotX, rotY, rotZ] = readingStart.rotation;
        return;
      }
      backClosed = false;
      if (reading) {
        view = 'page';
        focusedSide = insideSide;
      }
    }
    catch (error) {
      onError(error);
    }
    finally {
      openingCover = false;
      automaticGrab = undefined;
      busy = false;
      notify();
      redraw();
    }
  }
  async function goToPage(page: number): Promise<void> {
    if (busy || disposed)
      return;
    const target = spreadForPage(page, count);
    if (!opened)
      return open(page);
    if (target === index) {
      if (view === 'page')
        return focusPage(Number(page) - 1 === target ? -1 : 1);
      fit();
      return;
    }
    busy = true;
    loadingSpread = target;
    notify();
    try {
      const [a, b] = await Promise.all([insideTexture(target), insideTexture(target + 1), previewTextures(target)]);
      if (disposed)
        return;
      left.material.map = a;
      right.material.map = b;
      index = target;
      if (view === 'page') {
        focusedSide = Number(page) - 1 === target ? -1 : 1;
        readingY = readingFrame().limit;
      }
      trim();
      fit();
    }
    catch (error) {
      onError(error);
    }
    finally {
      loadingSpread = undefined;
      busy = false;
      warmNeighbors();
      notify();
      redraw();
    }
  }
  async function closeFront(grab?: PageGrab): Promise<void> {
    return closeCover(false, grab);
  }
  async function closeLast(grab?: PageGrab): Promise<void> {
    return closeCover(true, grab);
  }
  async function closeCover(back: boolean, grab?: PageGrab): Promise<void> {
    if (busy || disposed)
      return;
    const reading = isReading(), keepCamera = manualFraming && !reading, previousView = view, readingStart = cameraPose();
    if (reading)
      view = 'spread';
    automaticGrab = grab;
    busy = true;
    notify();
    const startCamera = camera.position.clone(), endCamera = spreadPosition(false), fromRotation = [rotX, rotY, rotZ];
    try {
      const committed = await gesture.animate(850, (t: number) => {
        frontFold = back ? 0 : t;
        backFold = back ? t : 0;
        spreadAmount = 1 - t;
        if (reading)
          readingMotion(readingStart, t, null);
        else if (!keepCamera) {
          camera.position.copy(startCamera).lerp(endCamera, t);
          rotX = fromRotation[0] * (1 - t) - closedTilt * Math.PI / 180 * t;
          rotY = fromRotation[1] * (1 - t);
          rotZ = fromRotation[2] * (1 - t);
        }
        render();
      }, animate);
      if (!committed) {
        frontFold = backFold = 0;
        spreadAmount = 1;
        view = previousView;
        camera.position.copy(readingStart.position);
        zoom = camera.zoom = readingStart.zoom;
        camera.updateProjectionMatrix();
        [rotX, rotY, rotZ] = readingStart.rotation;
        return;
      }
      // No mesh, visibility, material or geometry replacement at the endpoint.
      backClosed = back;
      opened = false;
      view = previousView === 'inspect' ? 'inspect' : 'spread';
      if (keepCamera)
        await settleClosed();
    }
    finally {
      automaticGrab = undefined;
      busy = false;
      notify();
      redraw();
    }
  }
  async function settleClosed() {
    const from = cameraPose(), target = spreadPosition(false);
    manualFraming = false;
    focusScroll = null;
    await animate(220, (t: number) => {
      focusMotion(from, target, t);
      rotX -= closedTilt * Math.PI / 180 * t;
    });
  }
  function scheduleCascade() {
    if (!cascadeFrame && !disposed)
      cascadeFrame = requestAnimationFrame(drawCascade);
  }
  function drawCascade(now: number) {
    cascadeFrame = 0;
    if (disposed || !cascade.busy)
      return;
    const { started, completed, stackIndex: position } = cascade.advance(now);
    for (const record of started) {
      const mesh = cascadePages.find(page => !page.userData.record)!, forward = record.direction > 0;
      record.mesh = mesh;
      mesh.userData.record = record;
      mesh.userData.side = record.direction;
      mesh.userData.layer = cascadePages.indexOf(mesh);
      mesh.material.map = record.maps![forward ? 1 : 0];
      mesh.userData.reverse.value = record.maps![forward ? 2 : 3];
      mesh.material.needsUpdate = true;
      mesh.visible = true;
      (forward ? right : left).material.map = record.maps![forward ? 3 : 2];
      if (cascadeFocus)
        cascadeCamera = { from: cameraPose(), start: now, target: record.target };
    }
    for (const record of completed) {
      index = record.target;
      (record.direction > 0 ? left : right).material.map = record.maps![record.direction > 0 ? 2 : 3];
      record.mesh!.visible = false;
      record.mesh!.userData.record = null;
    }
    stackIndex = position;
    const running = cascade.records.filter(record => record.start !== null), latest = running.at(-1);
    turnSurfaces = latest ? (cascade.direction > 0 ? [index, latest.target + 1] : [latest.target, index + 1]) : undefined;
    for (const record of running)
      deform(record.mesh!, record.progress);
    if (cascadeCamera)
      readingMotion(cascadeCamera.from, ease(Math.min(1, (now - cascadeCamera.start) / cascade.duration)), cascadeFocus ?? focusedSide, cascadeCamera.target);
    render();
    if (started.length || completed.length) {
      trim();
      warmNeighbors();
      notify();
    }
    if (cascade.busy) {
      scheduleCascade();
      return;
    }
    const close = cascade.closing, closeGrab = cascade.closingGrab;
    if (cascadeFocus) {
      view = 'page';
      focusedSide = cascadeFocus;
      readingY = readingFrame().limit;
    }
    cascade.clear();
    cascadeCamera = undefined;
    cascadeFocus = undefined;
    stackIndex = undefined;
    turnSurfaces = undefined;
    busy = false;
    trim();
    notify();
    redraw();
    if (close)
      void closeCover(close > 0, closeGrab);
  }
  function cascadeTurn(direction: number, focusSide?: number, grab?: PageGrab) {
    const reservation = cascade.reserve(index, direction, grab);
    if (!reservation)
      return;
    if ('close' in reservation) {
      notify();
      return;
    }
    const record = reservation.turn!, version = cascadeVersion;
    if (focusSide)
      cascadeFocus = focusSide;
    busy = true;
    notify();
    void Promise.all([Promise.all([record.from, record.from + 1, record.target, record.target + 1].map(insideTexture)), previewTextures(record.target)]).then(([maps]) => {
      if (disposed || version !== cascadeVersion)
        return;
      record.maps = maps;
      record.ready = true;
      scheduleCascade();
    }).catch(async (error: unknown) => {
      if (disposed || version !== cascadeVersion)
        return;
      ++cascadeVersion;
      cancelAnimationFrame(cascadeFrame);
      cascadeFrame = 0;
      for (const page of cascadePages) {
        page.visible = false;
        page.userData.record = null;
      }
      cascade.clear();
      cascadeCamera = undefined;
      cascadeFocus = undefined;
      stackIndex = undefined;
      turnSurfaces = undefined;
      onError(error);
      try {
        await spread();
      }
      catch {
      }
      finally {
        busy = false;
        fit();
        notify();
        redraw();
      }
    });
    warmNeighbors();
  }
  async function turn(direction: number, { focusSide, grab }: {
    focusSide?: number;
    grab?: PageGrab;
  } = {}): Promise<void> {
    if (disposed || options.controlled?.() === false)
      return;
    if (cascade.busy)
      return cascadeTurn(direction, focusSide, grab);
    if (busy)
      return;
    if (isReading() && !focusSide)
      return stepPage(direction, { grab });
    if (!opened)
      return open(undefined, { grab });
    if (direction < 0 && index <= 1)
      return closeFront(grab);
    const target = index + Math.sign(direction) * 2;
    if (target >= count - 1)
      return closeLast(grab);
    if (target < 1)
      return;
    if (!gesture.isDragging() && !reduced)
      return cascadeTurn(direction, focusSide, grab);
    automaticGrab = grab;
    busy = true;
    loadingSpread = target;
    notify();
    try {
      const [nextLeft, nextRight] = await Promise.all([insideTexture(target), insideTexture(target + 1), previewTextures(target)]);
      const forward = direction > 0;
      // Under the moving leaf, keep a real inside cover as a board rather
      // than promoting its artwork to a new curved paper surface.
      turnSurfaces = forward ? [index, target + 1] : [target, index + 1];
      turning.userData.side = forward ? 1 : -1;
      turning.material.map = forward ? right.material.map : left.material.map;
      reverseUniform.value = forward ? nextLeft : nextRight;
      turning.material.side = THREE.DoubleSide;
      turning.material.needsUpdate = true;
      (forward ? right : left).material.map = forward ? nextRight : nextLeft;
      deform(turning, 0);
      turning.visible = true;
      const start = cameraPose(), reading = readingFrame(focusSide ?? focusedSide, target);
      const committed = await gesture.animate(720, (t: number) => {
        stackIndex = index + (target - index) * t;
        deform(turning, t);
        if (focusSide)
          readingMotion(start, t, focusSide, target);
        render();
      }, animate);
      if (!committed) {
        turning.visible = false;
        await spread();
        return;
      }
      index = target;
      left.material.map = nextLeft;
      right.material.map = nextRight;
      if (focusSide) {
        view = 'page';
        focusedSide = focusSide;
        readingY = reading.limit;
      }
      turning.visible = false;
      trim();
    }
    catch (error) {
      turning.visible = false;
      onError(error);
      await spread();
    }
    finally {
      automaticGrab = undefined;
      loadingSpread = undefined;
      stackIndex = undefined;
      turnSurfaces = undefined;
      busy = false;
      warmNeighbors();
      notify();
      redraw();
    }
  }
  async function focusPage(side: number) {
    if (!opened || busy || disposed || interiorPage(index + (side > 0 ? 1 : 0), count) < 0)
      return;
    manualFraming = false;
    const from = cameraPose();
    focusedSide = side;
    view = 'page';
    const target = readingFrame();
    readingY = target.limit;
    busy = true;
    notify();
    try {
      await animate(280, (t: number) => focusMotion(from, new THREE.Vector3(target.centerX, readingY, target.distance), t));
    }
    finally {
      busy = false;
      notify();
    }
  }
  async function swapReadingSide(side: number) {
    const from = camera.position.clone(), destination = from.clone();
    destination.x += readingFrame(side).centerX - readingFrame().centerX;
    busy = true;
    notify();
    try {
      const committed = await gesture.animate(280, (t: number) => {
        camera.position.copy(from).lerp(destination, t);
        render();
      }, animate);
      if (committed)
        focusedSide = side;
      else
        camera.position.copy(from);
    }
    finally {
      busy = false;
      notify();
      redraw();
    }
  }
  async function focusSpread() {
    if (busy || disposed)
      return;
    manualFraming = false;
    const from = [camera.position.x, camera.position.y, camera.position.z, rotX, rotY, rotZ];
    view = 'spread';
    const destination = spreadPosition(), fromZoom = camera.zoom;
    busy = true;
    notify();
    try {
      await animate(250, (t: number) => {
        zoom = camera.zoom = fromZoom + (1 - fromZoom) * t;
        camera.updateProjectionMatrix();
        camera.position.set(from[0] + (destination.x - from[0]) * t, from[1] + (destination.y - from[1]) * t, from[2] + (destination.z - from[2]) * t);
        rotX = from[3] * (1 - t) - currentTilt() * Math.PI / 180 * t;
        rotY = from[4] * (1 - t);
        rotZ = from[5] * (1 - t);
      });
    }
    finally {
      busy = false;
      notify();
    }
  }
  function toggleFocus() {
    if (busy || disposed)
      return;
    if (view === 'inspect')
      return focusSpread();
    view = 'inspect';
    fit();
    notify();
  }
  async function stepPage(direction: number, { grab }: {
    grab?: PageGrab;
  } = {}): Promise<void> {
    if (busy || disposed || options.controlled?.() === false)
      return;
    const action = readingStep({ opened, backCover: backClosed, side: focusedSide, index, count }, direction);
    if (action === 'open')
      return open(undefined, { reading: true, grab });
    if (action === 'stay')
      return;
    if (action === 'side')
      return gesture.isDragging() ? swapReadingSide(-focusedSide) : focusPage(-focusedSide);
    if (action === 'front')
      return closeFront(grab);
    if (action === 'back')
      return closeLast(grab);
    await turn(direction, { focusSide: direction > 0 ? -1 : 1, grab });
  }
  function pageTap(e: PointerEvent) {
    clearTimeout(clickTimer);
    if ((busy && !cascade.busy) || disposed)
      return;
    if (cascade.busy) {
      const rect = surface.canvas.getBoundingClientRect();
      camera.updateMatrixWorld();
      book.updateMatrixWorld(true);
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
      const hit = raycaster.intersectObjects<THREE.Mesh>([frontCover, backCover, left, right, ...cascadePages.filter(page => page.visible)], false)[0];
      if (hit)
        void turn(cascadePages.some(page => page === hit.object) ? cascade.direction : (hit.object === right || hit.object === backCover ? 1 : -1), { grab: hitGrab(hit) });
      return;
    }
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (lastTouch && now - lastTouch.time < 320 && Math.hypot(e.clientX - lastTouch.x, e.clientY - lastTouch.y) < 24) {
        lastTouch = null;
        doubleClick(e);
        return;
      }
      lastTouch = { time: now, x: e.clientX, y: e.clientY };
    }
    if (view === 'inspect') {
      const back = !opened && clickedBack(e);
      if (pageGrab(e))
        clickTimer = setTimeout(() => {
          if (!opened)
            closedSide(back);
          void focusSpread();
        }, 320);
      return;
    }
    const rect = surface.canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    book.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
    const hit = raycaster.intersectObjects<THREE.Mesh>(opened ? [index === 1 ? frontCover : left, index + 1 >= count - 2 ? backCover : right] : [frontCover, backCover], false)[0];
    if (!hit)
      return;
    const wasOpened = opened, atIndex = index, direction = opened ? (hit.object === right || hit.object === backCover ? 1 : -1) : (hit.object === backCover ? -1 : 1), grab = hitGrab(hit);
    clickTimer = setTimeout(() => {
      if (disposed || busy || opened !== wasOpened || index !== atIndex)
        return;
      if (!opened) {
        const back = direction < 0;
        closedSide(back);
      }
      void turn(direction, { grab });
    }, 320);
  }
  gesture = dragTurns(host, { isOpen: (e: PointerEvent) => (view === 'spread' || isReading()) && Boolean(pageGrab(e)), isBusy: () => busy, canTurn: (direction: number) => {
      clearTimeout(clickTimer);
      if (options.controlled?.() === false)
        return false;
      if (isReading()) {
        const action = readingStep({ opened, backCover: backClosed, side: focusedSide, index, count }, direction);
        return action !== 'stay';
      }
      return opened || (!backClosed && direction > 0) || (backClosed && direction < 0);
    }, turn, fit, tap: pageTap, grabAt: pageGrab, canRotate: () => !opened, rotate: (dx: number) => {
      rotY += dx * .009;
      redraw();
    }, finishRotate: finishCoverFlip, pan: (dy: number) => {
      clearTimeout(clickTimer);
      if (isReading()) {
        const bounds = readingBounds();
        readingY = clampScroll(readingY + dy * bounds.visibleHeight / host.clientHeight, bounds.limit);
        camera.position.y = readingY;
        redraw();
      }
    }, swipe: (dx: number, dy: number) => {
      if (isReading()) {
        const direction = swipeDirection(dx, dy);
        if (direction)
          void stepPage(direction);
      }
    } });
  cleanups.push(() => gesture.dispose());
  const raycaster = new THREE.Raycaster();
  function hitGrab(hit: THREE.Intersection) {
    if (!hit?.uv)
      return undefined;
    const side = hit.object.userData.side, cover = hit.object === frontCover || hit.object === backCover, reverse = cover && hit.face?.materialIndex === 5;
    return { u: (side > 0) !== reverse ? hit.uv.x : 1 - hit.uv.x, v: hit.uv.y, pullY: 0 };
  }
  function pageGrab(event: MouseEvent) {
    const rect = surface.canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    book.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    const hit = raycaster.intersectObjects<THREE.Mesh>(opened ? [index === 1 ? frontCover : left, index + 1 >= count - 2 ? backCover : right] : [frontCover, backCover], false)[0];
    if (!hit?.uv)
      return null;
    const side = hit.object.userData.side, cover = hit.object === frontCover || hit.object === backCover;
    const reverse = cover && hit.face?.materialIndex === 5;
    const u = (side > 0) !== reverse ? hit.uv.x : 1 - hit.uv.x;
    const bounds = (hit.object as THREE.Mesh).geometry.boundingBox!, top = new THREE.Vector3().copy(hit.point), bottom = top.clone();
    hit.object.worldToLocal(top);
    bottom.copy(top);
    top.y = bounds.max.y;
    bottom.y = bounds.min.y;
    hit.object.localToWorld(top).project(camera);
    hit.object.localToWorld(bottom).project(camera);
    return { u, v: hit.uv.y, height: Math.max(1, Math.abs(top.y - bottom.y) * rect.height / 2) };
  }
  function doubleClick(event: MouseEvent) {
    clearTimeout(clickTimer);
    if (busy)
      return;
    if (isReading()) {
      void focusSpread();
      return;
    }
    if (!opened) {
      void focusCover(clickedBack(event));
      return;
    }
    const bounds = surface.canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), camera);
    const hit = raycaster.intersectObjects<THREE.Mesh>([index === 1 ? frontCover : left, index + 1 >= count - 2 ? backCover : right], false)[0];
    if (hit)
      void focusPage(hit.object === right || hit.object === backCover ? 1 : -1);
  }
  async function focusCover(back: boolean) {
    if (opened || busy || disposed)
      return;
    manualFraming = false;
    closedSide(back);
    const from = cameraPose();
    view = 'page';
    const destination = readingFrame();
    readingY = destination.limit;
    busy = true;
    notify();
    try {
      await animate(280, (t: number) => focusMotion(from, new THREE.Vector3(destination.centerX, readingY, destination.distance), t));
    }
    finally {
      busy = false;
      notify();
    }
  }
  function coverHit(event: MouseEvent) {
    const bounds = surface.canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    book.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), camera);
    return raycaster.intersectObjects([frontCover, backCover], false)[0];
  }
  function clickedBack(event: MouseEvent) {
    const hit = coverHit(event);
    return hit ? hit.object === backCover : backClosed;
  }
  async function finishCoverFlip() {
    const target = coverFlipTarget(rotY), from = rotY;
    busy = true;
    notify();
    try {
      await animate(200, (t: number) => {
        rotY = from + (target.angle - from) * t;
      });
      if (target.flip)
        closedSide(!backClosed);
    }
    finally {
      busy = false;
      notify();
      redraw();
    }
  }
  let drag: {
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    cascadeOnly: boolean;
    outside: boolean;
  } | null = null;
  const down = (e: PointerEvent) => {
    if (e.button !== 0)
      return;
    const outside = !pageGrab(e);
    if (busy && !cascade.busy && (!outside || !options.onDismiss))
      return;
    host.focus({ preventScroll: true });
    drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, cascadeOnly: busy, outside };
    host.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag)
      return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      drag.moved = true;
      clearTimeout(clickTimer);
    }
    if (!drag.cascadeOnly && drag.moved && (drag.outside || view === 'inspect')) {
      if (view !== 'inspect') {
        view = 'inspect';
        focusScroll = null;
        manualFraming = false;
        notify();
      }
      rotY += (e.clientX - drag.lastX) * .009;
      rotX += (e.clientY - drag.lastY) * .009;
      redraw();
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  };
  const up = (e: PointerEvent) => {
    if (!drag)
      return;
    const d = drag;
    drag = null;
    if (host.hasPointerCapture(e.pointerId))
      host.releasePointerCapture(e.pointerId);
    if (d.outside) {
      if (!d.moved)
        options.onDismiss?.();
      return;
    }
    if (!d.cascadeOnly && view === 'page' && d.moved) {
      const direction = swipeDirection(e.clientX - d.x, e.clientY - d.y);
      if (direction)
        void stepPage(direction);
    }
    else if (!d.moved)
      pageTap(e);
  };
  const cancel = () => {
    drag = null;
  };
  function applyManualFocus() {
    if (!focusScroll)
      return;
    const frame = readingFrame(opened ? focusScroll.side : focusedSide), extra = manualFocusZoom(focusScroll.progress);
    const target: CameraPose = { position: new THREE.Vector3(frame.centerX, Math.max(0, (frame.height - frame.visibleHeight / extra * (1 - 2 * frame.inset)) / 2), frameZoomDistance(frame, extra)), zoom: 1, rotation: [0, 0, 0] };
    const pose = manualFocusPose(focusScroll.progress, focusScroll.from, target, focusScroll.anchor);
    camera.position.copy(pose.position);
    zoom = camera.zoom = pose.zoom;
    camera.updateProjectionMatrix();
    [rotX, rotY, rotZ] = pose.rotation;
  }
  function changeBinding(kind: BindingKind, percent: number) {
    if (busy || disposed)
      return;
    const preserve = isReading() || manualFraming || (!opened && camera.zoom !== 1);
    const surface = () => {
      if (!opened)
        return coverSurface(true);
      const frame = readingFrame(focusScroll?.side ?? focusedSide);
      return { width: frame.width, center: new THREE.Vector3(frame.centerX, 0, 0) };
    };
    const before = preserve ? surface() : null;
    const oldLimit = isReading() ? readingBounds().limit : 0, scrollFraction = oldLimit ? readingY / oldLimit : 0;
    modelKind = kind;
    thicknessPercent = kind === 'comic' ? comicThicknessPercent(count) : percent;
    if (preserve) {
      const after = surface(), position = reframeSurface(camera.position, before!, after);
      camera.position.set(position.x, position.y, position.z);
      if (isReading()) {
        const bounds = readingBounds();
        readingY = camera.position.y = clampScroll(scrollFraction * bounds.limit, bounds.limit);
      }
      else if (focusScroll) {
        focusScroll.from.position = spreadPosition();
        if (focusScroll.anchor)
          focusScroll.anchor.pose.position = reframeSurface(focusScroll.anchor.pose.position, before!, after);
        applyManualFocus();
      }
    }
    redraw();
  }
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (busy)
      return;
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? host.clientHeight : 1);
    const mode = wheelFocusMode(view, e.ctrlKey || e.metaKey);
    if (mode === 'scroll') {
      const bounds = readingBounds();
      readingY = clampScroll(readingY - delta * bounds.visibleHeight / host.clientHeight, bounds.limit);
      camera.position.y = readingY;
      redraw();
      return;
    }
    const rect = surface.canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    book.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), camera);
    const hit = raycaster.intersectObjects<THREE.Mesh>(opened ? [index === 1 ? frontCover : left, index + 1 >= count - 2 ? backCover : right] : [frontCover, backCover], false)[0];
    if (mode === 'focus') {
      if (focusScroll && focusScroll.opened !== opened)
        focusScroll = null;
      if (!focusScroll) {
        if (!hit && delta < 0)
          return;
        const position = spreadPosition();
        const side = opened ? (hit ? (hit.object === left || hit.object === frontCover ? -1 : 1) : (camera.position.x < 0 ? -1 : 1)) : 0;
        const frame = readingFrame(side);
        focusScroll = { from: { position, zoom: 1, rotation: [-currentTilt() * Math.PI / 180, 0, 0] }, side, opened, zoomingOut: false, progress: recoverFocusProgress((camera.position.z - frame.planeZ) / camera.zoom, position.z - frame.planeZ, frame.distance - frame.planeZ) };
      }
      const hoverSide = opened && hit ? (hit.object === left || hit.object === frontCover ? -1 : 1) : 0;
      if (canRetargetFocus(focusScroll, hoverSide, delta)) {
        focusScroll.anchor = { blend: 0, pose: cameraPose() };
        focusScroll.side = hoverSide;
      }
      if (delta > 0 && !focusScroll.zoomingOut && focusScroll.anchor)
        focusScroll.anchor = focusReturnAnchor(focusScroll.progress, cameraPose());
      if (delta < 0 && focusScroll.zoomingOut && focusScroll.anchor)
        focusScroll.anchor = { blend: 0, pose: cameraPose() };
      if (delta < 0 && focusScroll.anchor?.blend !== undefined)
        focusScroll.anchor.blend = advanceFocusBlend(focusScroll.anchor.blend, delta);
      if (delta !== 0)
        focusScroll.zoomingOut = delta > 0;
      focusScroll.progress = manualFocusProgress(focusScroll.progress, delta);
      manualFraming = focusScroll.progress > 0;
      applyManualFocus();
      if (focusScroll.progress === 0)
        focusScroll = null;
      redraw();
      return;
    }
    const previous = camera.zoom;
    zoom = Math.max(.7, Math.min(4, previous * Math.exp(-delta * .0015)));
    camera.zoom = zoom;
    if (hit) {
      camera.position.x = anchoredPosition(camera.position.x, hit.point.x, previous, zoom);
      camera.position.y = anchoredPosition(camera.position.y, hit.point.y, previous, zoom);
      if (isReading())
        readingY = camera.position.y;
    }
    camera.updateProjectionMatrix();
    redraw();
  };
  host.addEventListener('pointerdown', down, { signal: events.signal });
  host.addEventListener('pointermove', move, { signal: events.signal });
  host.addEventListener('pointerup', up, { signal: events.signal });
  host.addEventListener('pointercancel', cancel, { signal: events.signal });
  host.addEventListener('wheel', wheel, { passive: false, signal: events.signal });
  host.addEventListener('dblclick', doubleClick, { signal: events.signal });
  const lost = (e: Event) => {
    e.preventDefault();
    onError(new Error('The 3D context was lost. Reopen the reader to try again.'));
  };
  surface.canvas.addEventListener('webglcontextlost', lost, { signal: events.signal });
  const visibility = () => {
    if (document.hidden) for (const finish of [...animations]) finish(true);
    preloader.pause(document.hidden);
    if (!document.hidden)
      redraw();
  };
  document.addEventListener('visibilitychange', visibility, { signal: events.signal });
  visibility();
  notify();
  render();
  warmNeighbors();
  async function showPage(page: number) {
    if (busy || disposed)
      return;
    if (page > 1 && page < count)
      return goToPage(page);
    const back = page >= count;
    if (opened)
      await closeCover(back);
    closedSide(back);
    view = 'spread';
    manualFraming = false;
    focusScroll = null;
    rotX = -closedTilt * Math.PI / 180;
    rotY = rotZ = 0;
    fit();
    notify();
  }
  return {
    enter, open, turn, goToPage, showPage, focusPage, focusSpread, toggleFocus,
    close() {
      if (opened && !busy && !disposed)
        return closeFront();
    },
    toggle() {
      if (busy || disposed)
        return;
      return opened ? closeFront() : open(resumeIndex + 1);
    },
    fit() {
      return focusSpread();
    },
    setCurl(v: number) {
      curl = Math.max(0, Math.min(maxPageCurl, v));
      redraw();
    },
    setCoverCurl(value: number) {
      coverCurl = Math.max(0, Math.min(maxPageCurl, value));
      redraw();
    },
    setLayerCurl(layer: number, value: number) {
      if (layer === 0 || layer === 1) {
        layerCurls[layer] = Math.max(0, Math.min(maxPageCurl, value));
        redraw();
      }
    },
    setWeightMultiplier(zone: number, value: number) {
      if (zone >= 0 && zone < 3) {
        weightMultipliers[zone] = Math.max(0, Math.min(3, value));
        redraw();
      }
    },
    setPaperStiffness(value: number) {
      paperStiffness = Math.max(0, Math.min(1, value));
      redraw();
    },
    setCoverStiffness(value: number) {
      coverStiffness = Math.max(0, Math.min(1, value));
      redraw();
    },
    setModel(kind: BindingKind, percent: number) {
      changeBinding(kind === 'book' ? 'book' : 'comic', percent);
    },
    setThickness(percent: number) {
      changeBinding(modelKind, percent);
    },
    setTilt(v: number) {
      tilt = v;
      focusScroll = null;
      if (opened && !isReading())
        rotX = -v * Math.PI / 180;
      redraw();
    },
    setClosedTilt(v: number) {
      closedTilt = v;
      focusScroll = null;
      if (!opened && !isReading())
        rotX = -v * Math.PI / 180;
      redraw();
    },
    setLight(v: number) {
      light.intensity = 1.2 + v * 2.8;
      ambient.intensity = .85 + v * .65;
      fill.intensity = .35 + v * .45;
      redraw();
    },
    leave,
    dispose,

  };
  }
  catch (cause) {
    dispose();
    throw cause;
  }
}
