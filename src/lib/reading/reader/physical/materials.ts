import * as THREE from 'three';
// A physical leaf has different artwork on its reverse, including when it is
// resting below another curled sheet. Keep one material and stable UVs per leaf.
export function bindReversePage(material: THREE.MeshStandardMaterial, map: THREE.Texture) {
  const reverse = { value: map }, prepare = material.onBeforeCompile;
  material.side = THREE.DoubleSide;
  material.userData.reversePage = reverse;
  material.onBeforeCompile = (shader, renderer) => {
    prepare.call(material, shader, renderer);
    shader.uniforms.reversePage = reverse;
    shader.fragmentShader = 'uniform sampler2D reversePage;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', '(gl_FrontFacing ? texture2D(map,vMapUv) : texture2D(reversePage,vec2(1.0-vMapUv.x,vMapUv.y)))'));
  };
  material.customProgramCacheKey = () => 'two-sided-printed-leaf';
  return reverse;
}
