/**
 * 3D view of the ghost laps: the track with its real elevation, kerbs and
 * run-off, F1-shaped cars, and four cameras: chase (behind the car), TV
 * (trackside cameras that cut as the car passes), helicopter (high above)
 * and free (drag to orbit, scroll to zoom; it keeps following the car).
 * Loaded lazily (three.js is large), only when someone picks 3D.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Circuit } from '../lib/story';
import type { GhostCar, GhostRace } from '../lib/ghost';
import { fontFamily } from '../theme';
import { kerbs, normals, TRACK_WIDTH } from './trackDetail';

// all coordinates are decimetres, z up
const BACKGROUND = 0x0f0f13;
const RUNOFF = 260;

export type CameraMode = 'chase' | 'tv' | 'heli' | 'free';

interface Props {
  race: GhostRace;
  circuit: Circuit;
  time: number;
  follow: GhostCar;
  height: number;
  camera: CameraMode;
}

interface TvSpot {
  position: THREE.Vector3;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  cars: Map<GhostCar, THREE.Group>;
  zBase: number;
  camPos: THREE.Vector3 | null;
  heading: number | null;
  tvSpots: TvSpot[];
  tvIndex: number;
  lastCar: THREE.Vector3 | null;
  mode: CameraMode | null;
  lastTime: number | null;
}

function textSprite(text: string, opts: { bg?: string; size?: number } = {}): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 30px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.bg ?? 'rgba(13,13,16,0.7)';
  ctx.fillRect(14, 6, 100, 36);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 64, 25);
  // constant size on screen, however close it is to the camera
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false }));
  const k = opts.size ?? 1;
  sprite.scale.set(0.075 * k, 0.028 * k, 1);
  sprite.userData.base = [0.075 * k, 0.028 * k];
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

/**
 * A ribbon offset from the outline between `inner` and `outer` (signed, along
 * the left normal): the whole loop, or just `indices`. With `stripe`, segments
 * are cut into pieces of that length and coloured alternately.
 */
function ribbon(circuit: Circuit, z: number[], zBase: number, inner: number, outer: number, lift: number, indices?: number[], stripe?: [number, THREE.Color, THREE.Color]): THREE.BufferGeometry {
  const n = circuit.x.length;
  const nrm = normals(circuit);
  const idx = indices ?? [...Array(n).keys(), 0];
  const positions: number[] = [];
  const colors: number[] = [];
  const lerp = (i: number, j: number, u: number, off: number) => {
    const x = circuit.x[i] + (circuit.x[j] - circuit.x[i]) * u;
    const y = circuit.y[i] + (circuit.y[j] - circuit.y[i]) * u;
    let nx = nrm[i][0] + (nrm[j][0] - nrm[i][0]) * u;
    let ny = nrm[i][1] + (nrm[j][1] - nrm[i][1]) * u;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    return [x + nx * off, y + ny * off, z[i] + (z[j] - z[i]) * u - zBase + lift];
  };
  let piece = 0;
  for (let k = 0; k + 1 < idx.length; k++) {
    const i = idx[k];
    const j = idx[k + 1];
    const segment = Math.hypot(circuit.x[j] - circuit.x[i], circuit.y[j] - circuit.y[i]);
    const parts = stripe ? Math.max(1, Math.round(segment / stripe[0])) : 1;
    for (let p = 0; p < parts; p++) {
      const u0 = p / parts;
      const u1 = (p + 1) / parts;
      const a = lerp(i, j, u0, inner);
      const b = lerp(i, j, u0, outer);
      const c = lerp(i, j, u1, inner);
      const d = lerp(i, j, u1, outer);
      for (const v of [a, b, c, b, d, c]) positions.push(...v);
      if (stripe) {
        const col = piece++ % 2 ? stripe[1] : stripe[2];
        for (let v = 0; v < 6; v++) colors.push(col.r, col.g, col.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (stripe) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function buildTrack(circuit: Circuit, z: number[], zBase: number): THREE.Object3D {
  const group = new THREE.Group();
  const half = TRACK_WIDTH / 2;
  const side = THREE.DoubleSide;
  // run-off and verges either side, then the asphalt
  for (const s of [1, -1]) {
    group.add(new THREE.Mesh(ribbon(circuit, z, zBase, s * half, s * (half + RUNOFF), -0.6), new THREE.MeshStandardMaterial({ color: 0x1b2a20, roughness: 1, side })));
  }
  group.add(new THREE.Mesh(ribbon(circuit, z, zBase, -half, half, 0), new THREE.MeshStandardMaterial({ color: 0x34343d, roughness: 0.9, side })));
  // white edge lines
  for (const s of [1, -1]) {
    group.add(new THREE.Mesh(ribbon(circuit, z, zBase, s * (half - 3), s * half, 0.4), new THREE.MeshBasicMaterial({ color: 0xd8d8e0, side })));
  }
  // red and white kerbs through each corner, both sides
  const red = new THREE.Color(0xd6303a);
  const white = new THREE.Color(0xeeeeee);
  const kerbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side });
  for (const kerb of kerbs(circuit)) {
    for (const s of [1, -1]) {
      group.add(new THREE.Mesh(ribbon(circuit, z, zBase, s * half, s * (half + 12), 0.8, kerb.indices, [30, red, white]), kerbMaterial));
    }
  }
  return group;
}

/** A simple F1 car, nose along +x, about 5.6 m long. */
function buildCar(car: GhostCar, emphasised: boolean): THREE.Group {
  const group = new THREE.Group();
  // the other laps are ghosts: see-through, so they never hide the car you follow
  const ghost = emphasised ? {} : { transparent: true, opacity: 0.6, depthWrite: false };
  const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(car.driver.color), roughness: 0.35, metalness: 0.3, ...ghost });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.6, ...ghost });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9, ...ghost });
  const box = (w: number, d: number, h: number, x: number, z: number, material: THREE.Material, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), material);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  box(46, 14, 1, -2, 1.2, carbon); // floor
  box(30, 8, 6, 2, 5, paint); // monocoque
  box(16, 4, 3, 24, 4, paint); // nose
  box(22, 15, 5, -6, 4.5, paint); // sidepods
  box(16, 6, 7, -14, 7.5, paint); // engine cover
  box(10, 1, 4, -18, 12, paint); // shark fin
  box(5, 20, 0.8, 30, 1.6, carbon); // front wing
  box(5, 0.6, 3, 30, 2.5, carbon, 9.7); // front endplates
  box(5, 0.6, 3, 30, 2.5, carbon, -9.7);
  box(5, 15, 0.8, -25, 13, paint); // rear wing
  box(6, 0.6, 9, -25, 9, carbon, 7.5); // rear endplates
  box(6, 0.6, 9, -25, 9, carbon, -7.5);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3, ...ghost }));
  helmet.position.set(-1, 0, 9);
  group.add(helmet);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.5, 6, 20, Math.PI), carbon);
  halo.rotation.set(0, Math.PI / 2, Math.PI / 2);
  halo.position.set(1, 0, 9.5);
  group.add(halo);
  for (const [x, w, r] of [
    [17, 3.6, 3.5],
    [-17, 4.4, 3.6],
  ]) {
    for (const y of [-9, 9]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), tyre);
      wheel.position.set(x, y, r);
      group.add(wheel);
    }
  }
  if (emphasised) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(34, 39, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
    ring.position.z = 1.2;
    group.add(ring);
  } else {
    // the followed car's name is already in the HUD
    const tag = textSprite(car.driver.code);
    tag.position.z = 40;
    group.add(tag);
  }
  return group;
}

/** Trackside camera spots every ~300 m, set back from the outside of the track. */
function tvSpots(circuit: Circuit, z: number[], zBase: number): TvSpot[] {
  const n = circuit.x.length;
  const nrm = normals(circuit);
  const cx = circuit.x.reduce((a, b) => a + b, 0) / n;
  const cy = circuit.y.reduce((a, b) => a + b, 0) / n;
  const spots: TvSpot[] = [];
  let run = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    run += Math.hypot(circuit.x[j] - circuit.x[i], circuit.y[j] - circuit.y[i]);
    if (run < 3000) continue;
    run = 0;
    // the side facing away from the circuit's middle usually has the open view
    const outward = (circuit.x[i] - cx) * nrm[i][0] + (circuit.y[i] - cy) * nrm[i][1] > 0 ? 1 : -1;
    const off = outward * (TRACK_WIDTH / 2 + RUNOFF + 60);
    spots.push({ position: new THREE.Vector3(circuit.x[i] + nrm[i][0] * off, circuit.y[i] + nrm[i][1] * off, z[i] - zBase + 90) });
  }
  return spots;
}

export default function ChaseCam3D({ race, circuit, time, follow, height, camera: mode }: Props) {
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
    scene.fog = new THREE.Fog(BACKGROUND, 2500, 14000);
    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / height, 1, 200000);
    camera.up.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x222230, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(3000, -2000, 5000);
    scene.add(sun);

    const elevation = outlineElevation(circuit, race, follow);
    const zBase = Math.min(...elevation);
    scene.add(buildTrack(circuit, elevation, zBase));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), new THREE.MeshStandardMaterial({ color: 0x15151b, roughness: 1 }));
    ground.position.z = -30;
    scene.add(ground);
    const grid = new THREE.GridHelper(80000, 160, 0x22222b, 0x1b1b22);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -29;
    scene.add(grid);

    // chequered start/finish line where the laps begin
    const start = race.state(follow, 0);
    const cells = 10;
    const cell = TRACK_WIDTH / cells;
    const lineGroup = new THREE.Group();
    for (let k = 0; k < cells; k++) {
      for (let row = 0; row < 2; row++) {
        const sq = new THREE.Mesh(new THREE.PlaneGeometry(cell, cell), new THREE.MeshBasicMaterial({ color: (k + row) % 2 ? 0x111111 : 0xf2f2f2 }));
        sq.position.set((row - 0.5) * cell, -TRACK_WIDTH / 2 + (k + 0.5) * cell, 0);
        lineGroup.add(sq);
      }
    }
    lineGroup.position.set(start.x, start.y, start.z - zBase + 1);
    lineGroup.rotation.z = start.heading;
    scene.add(lineGroup);

    // corner numbers floating beside the track
    for (const c of circuit.corners) {
      let nearest = 0;
      let bestD = Infinity;
      circuit.x.forEach((x, i) => {
        const d = (x - c.x) ** 2 + (circuit.y[i] - c.y) ** 2;
        if (d < bestD) [nearest, bestD] = [i, d];
      });
      const tag = textSprite(c.label, { bg: 'rgba(225,6,0,0.85)', size: 0.7 });
      tag.position.set(c.textX, c.textY, elevation[nearest] - zBase + 50);
      scene.add(tag);
    }

    const cars = new Map<GhostCar, THREE.Group>();
    for (const car of race.cars) {
      const group = buildCar(car, car === follow);
      cars.set(car, group);
      scene.add(group);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enabled = false;
    controls.maxPolarAngle = Math.PI * 0.44; // never quite down to ground level
    controls.minDistance = 60;
    controls.maxDistance = 20000;
    const r: SceneRefs = {
      renderer, scene, camera, controls, cars, zBase,
      camPos: null, heading: null, tvSpots: tvSpots(circuit, elevation, zBase), tvIndex: -1, lastCar: null, mode: null, lastTime: null,
    };
    refs.current = r;
    // in free mode the view changes while paused, so redraw on every drag
    controls.addEventListener('change', () => renderer.render(scene, camera));

    const resize = new ResizeObserver(() => {
      renderer.setSize(mount.clientWidth, height);
      camera.aspect = mount.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    resize.observe(mount);

    return () => {
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(material) ? material : material ? [material] : []).forEach((m) => {
          (m as THREE.SpriteMaterial).map?.dispose();
          m.dispose();
        });
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
    const carPos = new THREE.Vector3(me.x, me.y, me.z - r.zBase);
    const jumped = r.lastTime === null || Math.abs(time - r.lastTime) > 0.5;
    r.lastTime = time;
    if (r.heading === null || jumped) r.heading = me.heading;
    let diff = me.heading - r.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    r.heading += diff * 0.12;
    const h = r.heading;
    const cam = r.camera;
    const switched = r.mode !== mode;
    r.mode = mode;
    r.controls.enabled = mode === 'free';
    let fov = 55;

    if (mode === 'chase' || mode === 'heli') {
      const [back, up, ahead] = mode === 'chase' ? [280, 105, 220] : [700, 1400, 0];
      const target = new THREE.Vector3(carPos.x - Math.cos(h) * back, carPos.y - Math.sin(h) * back, carPos.z + up);
      if (!r.camPos || switched || jumped) r.camPos = target.clone();
      r.camPos.lerp(target, 0.2);
      cam.position.copy(r.camPos);
      cam.lookAt(carPos.x + Math.cos(h) * ahead, carPos.y + Math.sin(h) * ahead, carPos.z + 10);
      if (mode === 'heli') fov = 40;
    } else if (mode === 'tv') {
      // cut to the nearest trackside camera, with some stickiness so it doesn't flicker
      const dist = (i: number) => r.tvSpots[i].position.distanceTo(carPos);
      let best = 0;
      r.tvSpots.forEach((_, i) => dist(i) < dist(best) && (best = i));
      if (r.tvIndex < 0 || dist(best) < dist(r.tvIndex) * 0.8) r.tvIndex = best;
      const spot = r.tvSpots[r.tvIndex];
      if (spot) {
        cam.position.copy(spot.position);
        cam.lookAt(carPos.x, carPos.y, carPos.z + 5);
        // zoom so the car stays a similar size on screen
        fov = THREE.MathUtils.clamp((2 * Math.atan(170 / dist(r.tvIndex)) * 180) / Math.PI, 6, 60);
      }
      r.camPos = null;
    } else {
      // free: start from the chase view, then carry the camera along with the car
      if (switched || !r.lastCar) {
        cam.position.set(carPos.x - Math.cos(h) * 450, carPos.y - Math.sin(h) * 450, carPos.z + 260);
      } else {
        cam.position.add(carPos.clone().sub(r.lastCar));
      }
      r.controls.target.copy(carPos);
      r.controls.update();
      r.camPos = null;
    }
    r.lastCar = carPos;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      // unattenuated sprites still grow when the lens zooms in; keep labels the same size on screen
      const k = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(55 / 2));
      r.scene.traverse((o) => {
        const base = o.userData.base as [number, number] | undefined;
        if (base) o.scale.set(base[0] * k, base[1] * k, 1);
      });
    }
    r.renderer.render(r.scene, cam);
  }, [race, follow, time, mode]);

  return <div ref={mountRef} style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden', cursor: mode === 'free' ? 'grab' : undefined, touchAction: mode === 'free' ? 'none' : undefined }} />;
}
