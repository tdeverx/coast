import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { createBookModel } from '../src/lib/reading/reader/physical/book-model';
import { updatePageGeometry } from '../src/lib/reading/reader/physical/geometry';
import { budgetedPages, canPreloadPage, pageTextureBytes } from '../src/lib/reading/reader/physical/texture-budget';
import { NeighborPreloader, underPageIndex, reversePageIndex } from '../src/lib/reading/reader/physical/page-stack';
import type { BookMaterials } from '../src/lib/reading/reader/physical/model';

function model() {
  const materials = Object.fromEntries(['edges', 'ivory', 'boardEdge', 'frontInside', 'backInside', 'frontOutside', 'backOutside', 'left', 'right', 'staple'].map(name => [name, new THREE.MeshStandardMaterial()])) as unknown as BookMaterials;
  return createBookModel({ width: 2.8, height: 4.25, count: 34, materials });
}

test('packed deformation normals match Three.js for sheets, solids and degenerate triangles', () => {
  for (const geometry of [new THREE.PlaneGeometry(2, 3, 24, 8), new THREE.BoxGeometry(2, 3, .1, 24, 8, 4)]) {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.sin(p.getX(i) * 2) * (.2 + p.getY(i) * .03));
    p.setXYZ(0, p.getX(1), p.getY(1), p.getZ(1));
    const reference = geometry.clone();
    reference.computeVertexNormals();
    reference.computeBoundingSphere();
    reference.computeBoundingBox();
    updatePageGeometry(geometry, true);
    expect(geometry.attributes.normal.array).toEqual(reference.attributes.normal.array);
    expect(geometry.boundingSphere).toEqual(reference.boundingSphere);
    expect(geometry.boundingBox).toEqual(reference.boundingBox);
    geometry.dispose();
    reference.dispose();
  }
});

test('cover-only tuning reuses page geometry and all static printed shading buffers', () => {
  const book = model();
  book.update({ index: 9 });
  const positions = (book.right.geometry.attributes.position as THREE.BufferAttribute).version;
  const color = (book.right.geometry.attributes.color as THREE.BufferAttribute).version;
  const cover = (book.frontCover.geometry.attributes.position as THREE.BufferAttribute).version;
  book.update({ index: 9, coverCurl: .8 });
  expect((book.right.geometry.attributes.position as THREE.BufferAttribute).version).toBe(positions);
  expect((book.right.geometry.attributes.color as THREE.BufferAttribute).version).toBe(color);
  expect((book.frontCover.geometry.attributes.position as THREE.BufferAttribute).version).toBeGreaterThan(cover);
  expect((book.right.geometry.attributes.position as THREE.BufferAttribute).usage).toBe(THREE.DynamicDrawUsage);
  expect((book.right.geometry.attributes.color as THREE.BufferAttribute).usage).toBe(THREE.StaticDrawUsage);
});

test('a previously unavailable preview is deformed before it becomes visible', () => {
  const book = model(), page = book.underPages[0];
  book.update({ index: 9 });
  expect(page.visible).toBe(false);
  const number = underPageIndex(9, page.userData.side, page.userData.layer, 34);
  page.userData.loadedPage = number;
  page.userData.loadedReversePage = reversePageIndex(number, page.userData.side, 34);
  book.update({ index: 9 });
  expect(page.visible).toBe(true);
  expect(page.geometry.boundingBox).not.toBeNull();
  expect((page.geometry.attributes.position as THREE.BufferAttribute).version).toBeGreaterThan(0);
});

test('solid groups retain full ordered index coverage while merging only identical materials', () => {
  const book = model();
  for (const mesh of [...book.blocks, ...book.covers]) {
    const groups = mesh.geometry.groups;
    expect(groups.length).toBe(mesh.userData.type === 'block' ? 2 : 3);
    expect(groups[0].start).toBe(0);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(mesh.geometry.index!.count);
    for (let i = 1; i < groups.length; i++) expect(groups[i].start).toBe(groups[i - 1].start + groups[i - 1].count);
  }
});

test('texture budgets reserve active faces first and admit speculation by bytes', () => {
  const sizes = new Map([[0, 40], [1, 60], [2, 80], [3, 20]]);
  expect([...budgetedPages(sizes, new Set([0]), [2, 3, 1], 100)]).toEqual([0, 3]);
  expect([...budgetedPages(sizes, new Set([0, 2]), [1, 3], 100)]).toEqual([0, 2]);
  expect(pageTextureBytes(2048, 1024)).toBe(11184812);
});

test('declined speculative work does not decode or spin and can be admitted on the next warm', async () => {
  const loaded = new Set<number>();
  let allowed = false;
  const preloader = new NeighborPreloader({ has: page => loaded.has(page), canLoad: () => allowed, load: async page => { loaded.add(page); } });
  await preloader.warm([1, 2]);
  expect([...loaded]).toEqual([]);
  expect(preloader.running).toBeUndefined();
  allowed = true;
  await preloader.warm([1, 2]);
  expect([...loaded]).toEqual([1, 2]);
  preloader.stop();
});


test('late speculation must still be wanted and fit its actual decoded bytes', () => {
  const sizes = new Map([[0, 90]]), required = new Set([0]);
  expect(canPreloadPage(sizes, required, [2], 2, 5, 100)).toBe(true);
  expect(canPreloadPage(sizes, required, [2], 2, 15, 100)).toBe(false);
  expect(canPreloadPage(sizes, required, [3], 2, 5, 100)).toBe(false);
  // A turn that now requires the pending page keeps its full-resolution image.
  expect(canPreloadPage(sizes, new Set([0, 2]), [3], 2, 15, 100)).toBe(true);
});

test('texture byte accounting includes rectangular and non-power-of-two mip tails', () => {
  expect(pageTextureBytes(1, 2048)).toBe(16380);
  expect(pageTextureBytes(3, 5)).toBe(72);
  expect(pageTextureBytes(1, 1)).toBe(4);
});
