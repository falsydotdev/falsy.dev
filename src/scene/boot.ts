import * as THREE from 'three/webgpu';

declare global {
  interface Window {
    __falsyScene?: { inits: number; frames: number; backend: string; canvas: HTMLCanvasElement };
  }
}

export async function startSpike(host: HTMLElement, forceWebGL: boolean) {
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  host.appendChild(renderer.domElement);
  await renderer.init();

  const state = {
    inits: (window.__falsyScene?.inits ?? 0) + 1,
    frames: 0,
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2',
    canvas: renderer.domElement,
  };
  window.__falsyScene = state;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0.6, 3.2);
  camera.lookAt(0, 0, 0);
  const sun = new THREE.DirectionalLight(0xfff1e0, 3);
  sun.position.set(-3, 1, 1);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.MeshStandardNodeMaterial({ color: 0xb4623a, roughness: 0.95 }));
  scene.add(sun, planet);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop((t) => {
    planet.rotation.y = t / 8000;
    renderer.render(scene, camera);
    state.frames++;
  });
  host.classList.add('live');
}
