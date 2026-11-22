/**
 * 3D "chase cam": the track drawn with its real elevation, the laps as
 * coloured cars, and a camera that follows one car from behind and above.
 * Loaded lazily (three.js is large), only when someone picks 3D.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Circuit } from '../lib/story';
import type { GhostCar, GhostRace } from '../lib/ghost';
import { fontFamily } from '../theme';

const TRACK_WIDTH = 140; // decimetres (~14 m); all coordinates are decimetres
const BACKGROUND = 0x0f0f13;

interface Props {
  race: GhostRace;
  circuit: Circuit;
  time: number;
  follow: GhostCar;
  height: number;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cars: Map<GhostCar, THREE.Group>;
  zBase: number;
  camPos: THREE.Vector3 | null;
  heading: number | null;
}

function label(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 30px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(13,13,16,0.7)';
  ctx.fillRect(14, 6, 100, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 64, 25);
  // constant size on screen, however close the car is to the camera
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false }));
  sprite.scale.set(0.075, 0.028, 1);
  return sprite;
}

/** Elevation for each outline point, from the nearest point a car actually drove. */
function outlineElevation(circuit: Circuit, race: GhostRace, car: GhostCar): number[] {
  const samples: [number, number, number][] = [];
  for (let t = 0; t <= car.lapTime; t += 0.2) {
    const s = race.state(car, t);
    samples.push([s.x, s.y, s.z]);
  }
  return circuit.x.map((x, i) => {
    const y = circuit.y[i];
    let best = samples[0];
    let bestD = Infinity;
    for (const s of samples) {
      const d = (s[0] - x) ** 2 + (s[1] - y) ** 2;
      if (d < bestD) [best, bestD] = [s, d];
    }
    return best[2];
  });
}

function buildTrack(circuit: Circuit, z: number[], zBase: number): THREE.Object3D {
  const n = circuit.x.length;
  const group = new THREE.Group();
  const positions: number[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const tx = circuit.x[next] - circuit.x[prev];
    const ty = circuit.y[next] - circuit.y[prev];
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const h = z[i] - zBase;
    left.push(new THREE.Vector3(circuit.x[i] + (nx * TRACK_WIDTH) / 2, circuit.y[i] + (ny * TRACK_WIDTH) / 2, h));
    right.push(new THREE.Vector3(circuit.x[i] - (nx * TRACK_WIDTH) / 2, circuit.y[i] - (ny * TRACK_WIDTH) / 2, h));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (const v of [left[i], right[i], left[j], right[i], right[j], left[j]]) positions.push(v.x, v.y, v.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x34343d, roughness: 0.9, side: THREE.DoubleSide })));
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xd8d8e0, transparent: true, opacity: 0.55 });
  for (const edge of [left, right]) {
    const pts = edge.map((v) => new THREE.Vector3(v.x, v.y, v.z + 1));
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), edgeMaterial));
  }
  return group;
}

function buildCar(car: GhostCar, emphasised: boolean): THREE.Group {
  const group = new THREE.Group();
  const color = new THREE.Color(car.driver.color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(55, 19, 9), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }));
  body.position.z = 6;
  group.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 20, 7), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  wing.position.set(-26, 0, 14);
  group.add(wing);
  if (emphasised) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(34, 40, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
    ring.position.z = 1.5;
    group.add(ring);
  }
  if (!emphasised) {
    // the followed car's name is already in the HUD
    const tag = label(car.driver.code);
    tag.position.z = 40;
    group.add(tag);
  }
  return group;
}

export default function ChaseCam3D({ race, circuit, time, follow, height }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const refs = useRef<SceneRefs | null>(null);

  // Build the scene when the laps change.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, height);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.Fog(BACKGROUND, 1800, 9000);
    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / height, 1, 100000);
    camera.up.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x222230, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(3000, -2000, 5000);
    scene.add(sun);

    const elevation = outlineElevation(circuit, race, follow);
    const zBase = Math.min(...elevation);
    scene.add(buildTrack(circuit, elevation, zBase));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: 0x15151b, roughness: 1 }));
    ground.position.z = -30;
    scene.add(ground);
    const grid = new THREE.GridHelper(60000, 120, 0x22222b, 0x1b1b22);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -29;
    scene.add(grid);

    // start/finish line where the followed lap begins
    const start = race.state(follow, 0);
    const line = new THREE.Mesh(new THREE.BoxGeometry(6, TRACK_WIDTH, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    line.position.set(start.x, start.y, start.z - zBase + 1);
    line.rotation.z = start.heading;
    scene.add(line);

    const cars = new Map<GhostCar, THREE.Group>();
    for (const car of race.cars) {
      const group = buildCar(car, car === follow);
      cars.set(car, group);
      scene.add(group);
    }
    refs.current = { renderer, scene, camera, cars, zBase, camPos: null, heading: null };

    const resize = new ResizeObserver(() => {
      renderer.setSize(mount.clientWidth, height);
      camera.aspect = mount.clientWidth / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(mount);

    return () => {
      resize.disconnect();
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(material) ? material : material ? [material] : []).forEach((m) => m.dispose());
      });
      mount.removeChild(renderer.domElement);
      refs.current = null;
    };
  }, [race, circuit, follow, height]);

  // Move the cars and the camera every frame.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    for (const [car, group] of r.cars) {
      const s = race.state(car, time);
      group.position.set(s.x, s.y, s.z - r.zBase);
      group.rotation.z = s.heading;
      group.visible = !(s.finished && car !== follow && time > car.lapTime + 1.5);
    }
    const me = race.state(follow, time);
    if (r.heading === null) r.heading = me.heading;
    let diff = me.heading - r.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    r.heading += diff * 0.12;
    const h = r.heading;
    const z = me.z - r.zBase;
    const target = new THREE.Vector3(me.x - Math.cos(h) * 280, me.y - Math.sin(h) * 280, z + 105);
    if (!r.camPos) r.camPos = target.clone();
    r.camPos.lerp(target, 0.2);
    r.camera.position.copy(r.camPos);
    r.camera.lookAt(me.x + Math.cos(h) * 220, me.y + Math.sin(h) * 220, z + 10);
    r.renderer.render(r.scene, r.camera);
  }, [race, follow, time]);

  return <div ref={mountRef} style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden' }} />;
}
