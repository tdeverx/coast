import type { BindingKind, BookMaterials, BookPose, PageMesh } from './model.ts';
import * as THREE from 'three';
import { dynamicPageGeometry, updatePageGeometry } from './geometry.ts';
import { sampleLeaf, sampleOpeningLeaf, layerRestCurl, pageMeshSegments, hingeSample, gutterWeight, pageDimensions, comicSpineProfile, comicSpineWidth, paperEdgeRepeat, comicThicknessBounds } from './page-geometry.ts';
import { underPageIndex, reversePageIndex, sheetPitch, layerCurl, boundLayerCurls, defaultCurlTargets, defaultWeightMultipliers, stackCurlScale } from './page-stack.ts';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function bindingDimensions(kind: BindingKind, height: number, thicknessPercent: number) {
  const hardback = kind === 'book';
  const totalDepth = height * (hardback ? clamp(thicknessPercent, .3, 20) : clamp(thicknessPercent, comicThicknessBounds.min, comicThicknessBounds.max)) / 100;
  const board = Math.min(height * (hardback ? .012 : .0008), totalDepth * .18);
  return {
    totalDepth,
    depth: totalDepth - 2 * board - .002,
    board,
    overhangX: 0,
    overhangY: 0,
    hingeBendScale: hardback ? 0 : .35,
    coverRestScale: hardback ? 0 : 1,
  };
}
// Page 2 and the penultimate face are the insides of the permanent covers.
export function stackDepths(index: number, count: number, depth: number) {
  const fraction = count <= 4 ? .5 : clamp((index - 1) / (count - 4), 0, 1);
  return { left: depth * fraction, right: depth * (1 - fraction) };
}
/** A single binding: the same boards, paper blocks and printed faces in every pose. */
export function createBookModel({ width, height, count, materials }: {
  width: number;
  height: number;
  count: number;
  materials: BookMaterials;
}) {
  const group = new THREE.Group(), parts: THREE.Mesh[] = [], blocks: THREE.Mesh[] = [], covers: THREE.Mesh[] = [], pages: PageMesh[] = [], underPages: PageMesh[] = [];
  function solid(side: number, type: string, mats: THREE.Material | THREE.Material[]) {
    const geometry = new THREE.BoxGeometry(1, 1, 1, pageMeshSegments.width, pageMeshSegments.height, 4);
    dynamicPageGeometry(geometry);
    if (type === 'block') (geometry.attributes.uv as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    if (Array.isArray(mats)) {
      const groups: typeof geometry.groups = [];
      for (const current of geometry.groups) {
        const previous = groups.at(-1);
        if (previous && previous.start + previous.count === current.start && mats[previous.materialIndex!] === mats[current.materialIndex!])
          previous.count += current.count;
        else groups.push({ ...current });
      }
      geometry.groups = groups;
    }
    const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const x = side * (hingeSample(.5 + side * positions.getX(i)) - .5);
      positions.setX(i, x);
      if (Math.abs(normals.getX(i)) < .5)
        uv.setX(i, normals.getZ(i) < -.5 ? .5 - x : .5 + x);
    }
    const mesh = new THREE.Mesh(geometry, mats);
    mesh.userData = { side, type, base: new Float32Array(geometry.attributes.position.array) };
    if (type === 'cover') {
      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const shade = 1 - .13 * Math.exp(-(.5 + side * positions.getX(i)) * 32);
        colors.fill(shade, i * 3, i * 3 + 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    parts.push(mesh);
    return mesh;
  }
  for (const side of [-1, 1]) {
    blocks.push(solid(side, 'block', [materials.edges, materials.edges, materials.edges, materials.edges, materials.ivory, materials.ivory]));
    covers.push(solid(side, 'cover', [materials.boardEdge, materials.boardEdge, materials.boardEdge, materials.boardEdge, side < 0 ? materials.frontInside : materials.backInside, side < 0 ? materials.frontOutside : materials.backOutside]));
    for (let layer = 0; layer <= 2; layer++) {
      const face = side < 0 ? materials.left : materials.right;
      const map = layer ? (side < 0 ? materials.underLeft : materials.underRight)?.[layer - 1] ?? face : face;
      const page = new THREE.Mesh(new THREE.PlaneGeometry(width, height, pageMeshSegments.width, pageMeshSegments.height), map as THREE.MeshStandardMaterial);
      dynamicPageGeometry(page.geometry);
      const uv = page.geometry.attributes.uv;
      const colors = new Float32Array(uv.count * 3);
      for (let i = 0; i < uv.count; i++) {
        const u = hingeSample(side > 0 ? uv.getX(i) : 1 - uv.getX(i));
        uv.setX(i, side > 0 ? u : 1 - u);
        const printedU = side > 0 ? uv.getX(i) : 1 - uv.getX(i);
        const shade = 1 - .13 * Math.exp(-printedU * 32);
        colors.fill(shade, i * 3, i * 3 + 3);
      }
      page.userData = { side, layer, loadedPage: -1, loadedReversePage: -1, baseUV: new Float32Array(page.geometry.attributes.uv.array) };
      page.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      page.castShadow = layer === 0;
      page.receiveShadow = true;
      page.frustumCulled = false;
      group.add(page);
      (layer ? underPages : pages).push(page);
    }
  }
  // A hardback needs a solid spine, tucked inside the cover footprint. The
  // comic's crease is formed by its existing covers and paper, with no shell.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials.boardEdge);
  // The narrow outer plane keeps directional lighting, but does not receive
  // thin-paper shadow-map noise through the binding. It still casts shadows.
  spine.castShadow = true;
  spine.receiveShadow = false;
  group.add(spine);
  const staples = [-.27, .27].map(y => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials.staple);
    m.position.y = height * y;
    group.add(m);
    return m;
  });
  let previous: string | undefined;
  function update({ index = 1, stackIndex = index, leftPage = index, rightPage = index + 1, kind = 'comic', thickness = .6, frontFold = 0, backFold = 0, opening = false, curl = defaultCurlTargets[0], corner = 0, layerCurls = defaultCurlTargets.slice(1, 3), coverCurl = defaultCurlTargets[3], coverStiffness = .6, grab, weightMultipliers = defaultWeightMultipliers }: BookPose = {}) {
    for (const page of underPages) {
      const { side, layer } = page.userData, number = underPageIndex(side < 0 ? leftPage : rightPage, side, layer, count);
      const reverse = reversePageIndex(number, side, count);
      page.userData.pageIndex = number;
      page.userData.reversePageIndex = reverse;
      page.visible = number >= 0 && page.userData.loadedPage === number && page.userData.loadedReversePage === reverse;
    }
    for (const page of pages) {
      const cover = count > 1 && (page.userData.side < 0 ? leftPage === 1 : rightPage === count - 2);
      page.visible = (count === 1 ? page.userData.side < 0 : !cover) && page.userData.textureReady !== false;
    }
    const key = [index, stackIndex, leftPage, rightPage, kind, thickness, frontFold, backFold, opening, curl, corner, ...layerCurls, coverCurl, coverStiffness, grab?.v, grab?.pullY, ...weightMultipliers, ...pages.map(page => page.visible), ...underPages.map(page => page.visible)].join(',');
    if (key === previous)
      return;
    previous = key;
    const dimensions = bindingDimensions(kind, height, thickness), depths = stackDepths(stackIndex, count, dimensions.depth);
    const paper = pageDimensions(kind, width, height);
    const weightScale = (side: number) => stackCurlScale(dimensions.depth > 0 ? (side < 0 ? depths.left : depths.right) / dimensions.depth : .5, weightMultipliers);
    const weights = [weightScale(-1), weightScale(1)];
    const folds = [frontFold, backFold];
    const closure = Math.max(...folds);
    const frontZ = -(depths.left + dimensions.board + .001) * Math.cos(Math.PI * frontFold);
    const backZ = -(depths.right + dimensions.board + .001) * Math.cos(Math.PI * backFold);
    const spineDepth = Math.max(.002, Math.abs(frontZ - backZ)), centre = (frontZ + backZ) / 2;
    const taperWidth = comicSpineWidth(width, spineDepth);
    const insideCover = (side: number) => count > 1 && (side < 0 ? leftPage === 1 : rightPage === count - 2);
    const pitch = sheetPitch(count, dimensions.depth);
    const layers = (side: number) => [1, 2].filter((layer: number) => underPageIndex(side < 0 ? leftPage : rightPage, side, layer, count) >= 0).length;
    // During a curl the newly exposed page starts in its old lower position;
    // the landing stack lowers by the same amount. Cascades add continuously.
    const exposed = (side: number) => Math.max(0, side < 0 ? (stackIndex - leftPage) / 2 : (rightPage - 1 - stackIndex) / 2);
    const bounded = boundLayerCurls([curl, ...layerCurls, coverCurl]);
    const pageCurls = bounded.slice(0, 3);
    const strength = (level: number) => layerCurl(level, pageCurls);
    // Keep the visual centre on the rotation axis as either half folds shut.
    group.position.x = (width + dimensions.overhangX) / 2 * (backFold - frontFold);
    group.position.z = (depths.right - depths.left) / 2 * (frontFold - backFold);
    const sampleOptions = { width, height, side: 1, curl: .45, restCurl: 0, corner: kind === 'comic' ? corner : 0, grab: kind === 'comic' ? grab : undefined, stiffness: coverStiffness, bendScale: kind === 'book' ? 0 : 1 };
    const restScale = (1 - closure) ** 2;
    const skin = dimensions.board / (dimensions.depth + 2 * dimensions.board);
    function point(u: number, v: number, side: number, fold: number, z: number, extraX = 0, extraY = 0, cover = false, restStrength = .45) {
      const rest = layerRestCurl(restStrength * weights[side < 0 ? 0 : 1]) * restScale * (cover ? dimensions.coverRestScale : 1);
      const size = cover ? { width, height } : paper;
      const sample = opening && fold > 0 && fold < 1 ? sampleOpeningLeaf : sampleLeaf;
      sampleOptions.width = size.width;
      sampleOptions.height = size.height;
      sampleOptions.side = side;
      sampleOptions.restCurl = rest;
      const p = sample(u, v, fold, sampleOptions);
      const angle = Math.PI * fold;
      const result = { x: p.x + side * Math.cos(angle) * extraX * u + p.nx * z, y: p.y + extraY * (v - .5) + p.ny * z, z: p.z + p.nz * z };
      if (kind === 'comic' && closure > 0) {
        // Covers and paper share the same thickness-bounded fold. Its outer
        // silhouette keeps the artwork's original horizontal coordinates.
        const profile = comicSpineProfile(u * width, result.z - centre, spineDepth / 2, taperWidth, skin);
        result.x += side * Math.cos(angle) * profile.x * closure * closure;
        result.z += (centre + profile.z - result.z) * closure * closure;
      }
      return result;
    }
    for (const mesh of parts) {
      const { side, type, base } = mesh.userData, fold = folds[side < 0 ? 0 : 1], depth = side < 0 ? depths.left : depths.right;
      const cover = type === 'cover', positions = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
      mesh.visible = cover || (!insideCover(side) && depth > .0001);
      if (!mesh.visible) continue;
      const solidDepth = cover ? dimensions.board : Math.max(.0001, depth);
      const lowest = layers(side) + exposed(side), recess = Math.min(pitch * lowest, Math.max(0, depth - .0001)) * (1 - closure);
      const baseCurl = cover ? bounded[3] : strength(lowest);
      const meshKey = [kind, fold, opening, closure, centre, spineDepth, taperWidth, depth, solidDepth, recess, baseCurl, weights[side < 0 ? 0 : 1], coverStiffness, corner, grab?.v, grab?.pullY].join(',');
      if (mesh.userData.pose === meshKey) continue;
      mesh.userData.pose = meshKey;
      const underlap = cover ? 0 : height * .0003;
      const size = cover ? { width, height } : paper;
      const spineInset = !cover && kind === 'book' ? .012 : 0;
      for (let i = 0; i < positions.count; i++) {
        // A tiny underlap prevents ivory block faces peeking past the sheet.
        // Recess only the hardback's supporting block behind the flat spine.
        // Printed pages retain their complete image and their hinge at zero.
        const u = spineInset / size.width + (.5 + side * base[i * 3]) * (1 - (underlap + spineInset) / size.width), v = (base[i * 3 + 1] * (size.height - 2 * underlap)) / size.height + .5;
        // Board inside is flush with its paper block; its thickness goes outward.
        const columnDepth = Math.max(.0001, depth - recess * gutterWeight(u));
        const z = cover ? -depth - dimensions.board / 2 - .001 + base[i * 3 + 2] * solidDepth : -depth + (base[i * 3 + 2] + .5) * columnDepth;
        // Both permanent covers use the same cover layer, independent of how
        // many preview sheets are currently exposed on either side.
        const restStrength = baseCurl * (kind === 'book' && !cover ? base[i * 3 + 2] + .5 : 1);
        const p = point(u, v, side, fold, z, cover ? dimensions.overhangX : 0, cover ? dimensions.overhangY : 0, cover, restStrength);
        positions.setXYZ(i, p.x, p.y, p.z);
        // Every edge face uses the paper-layer coordinate, including the tall
        // fore-edge faces whose default box UVs ran down the page height.
        if (!cover)
          uv.setY(i, (base[i * 3 + 2] + .5) * paperEdgeRepeat(columnDepth, height));
      }
      if (!cover) uv.needsUpdate = true;
      updatePageGeometry(mesh.geometry, true);
    }
    for (const page of [...pages, ...underPages]) {
      if (!page.visible) continue;
      const { side, baseUV, layer } = page.userData, fold = folds[side < 0 ? 0 : 1], positions = page.geometry.attributes.position;
      const level = (layer && page.userData.pageIndex < 0 ? 0 : layer) + exposed(side);
      const restStrength = strength(level);
      const pageKey = [kind, fold, opening, closure, centre, spineDepth, taperWidth, pitch, level, restStrength, weights[side < 0 ? 0 : 1], coverStiffness, corner, grab?.v, grab?.pullY].join(',');
      if (page.userData.pose === pageKey) continue;
      page.userData.pose = pageKey;
      for (let i = 0; i < positions.count; i++) {
        const u = side > 0 ? baseUV[i * 2] : 1 - baseUV[i * 2], v = baseUV[i * 2 + 1], z = .003 * (1 - closure) - pitch * level * gutterWeight(u), p = point(u, v, side, fold, z, 0, 0, false, restStrength);
        positions.setXYZ(i, p.x, p.y, p.z);
      }
      updatePageGeometry(page.geometry, true);
    }
    const top = Math.max(0, -depths.left * Math.cos(Math.PI * frontFold), -depths.right * Math.cos(Math.PI * backFold));
    const bottom = Math.min(0, -depths.left * Math.cos(Math.PI * frontFold), -depths.right * Math.cos(Math.PI * backFold));
    // Keep its caps clear of the printed leaves as well as keeping the paper
    // edge behind its outer plane: neither surface can become coplanar.
    // Rigid hardback spine width belongs to the binding, not to the difference
    // between the changing left/right stacks. It never collapses at mid-book.
    spine.visible = kind === 'book';
    spine.scale.set(.045, height, Math.max(.0001, dimensions.depth - .002));
    spine.rotation.y = (1 - closure) * Math.PI / 2;
    const openSpineZ = Math.min(frontZ, backZ) - .045 / 2 - .001;
    spine.position.set((frontFold - backFold) * .045 / 2, 0, centre * closure + openSpineZ * (1 - closure));
    for (const staple of staples) {
      staple.visible = kind === 'comic';
      staple.scale.set(.005, height * .025, Math.max(.003, (top - bottom + dimensions.board * 2) * (1 - closure)));
      staple.position.x = (frontFold - backFold) * .003;
      staple.position.z = (top + bottom) / 2 * (1 - closure) + centre * closure;
    }
  }
  return { group, frontCover: covers[0], backCover: covers[1], left: pages[0], right: pages[1], underPages, blocks, covers, spine, update };
}
