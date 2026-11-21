// Real-time 3D "game" scene for the TV and the intro shot.
// Everything is procedural (no downloaded assets) and driven by time t, so frames are deterministic.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eout = x => 1 - Math.pow(1 - x, 3);
const eio = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const back = x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

export function createGame3D() {
  let seed = 1234;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb8607a, 0.0024);

  // ---------- sky + sun (custom sunset gradient) ----------
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(87.6), THREE.MathUtils.degToRad(192));
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float toward = max(dot(normalize(vec3(d.x,0.,d.z)), normalize(vec3(sunDir.x,0.,sunDir.z))), 0.);
        vec3 zenith = vec3(0.05, 0.07, 0.28);
        vec3 mid = vec3(0.42, 0.16, 0.48);
        vec3 low = mix(vec3(0.95, 0.30, 0.38), vec3(1.6, 0.62, 0.22), toward);
        vec3 hor = mix(vec3(1.0, 0.42, 0.40), vec3(1.7, 0.78, 0.30), pow(toward, 3.));
        vec3 c = h > 0.25 ? mix(mid, zenith, smoothstep(.25, .8, h)) :
                 h > 0.07 ? mix(low, mid, smoothstep(.07, .25, h)) :
                 mix(hor, low, smoothstep(0., .07, h));
        if (h < 0.) c = mix(hor, vec3(0.25, 0.12, 0.2), smoothstep(0., -0.15, h));
        float s = max(dot(d, normalize(sunDir)), 0.);
        c += vec3(3.0, 1.5, 0.5) * pow(s, 120.) + vec3(1.0, 0.4, 0.12) * pow(s, 14.) * .35;
        c += vec3(30., 22., 12.) * smoothstep(0.99965, 0.9998, s);
        // soft clouds bands
        float band = sin(d.x * 9. + d.z * 4.) * sin(h * 60. + d.x * 5.) ;
        c = mix(c, c * vec3(1.25, .8, .9) + vec3(.15,.05,.08) * toward, smoothstep(.55, .95, band) * smoothstep(.03, .12, h) * (1. - smoothstep(.2, .35, h)) * .6);
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`
  });
  const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.frustumCulled = false;
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.75;

  const sunLight = new THREE.DirectionalLight(0xffb27a, 3.2);
  const lightDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(198));
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 });
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(0x8e74d6, 0x3a2430, 0.55));

  // ---------- procedural textures ----------
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  }
  function waveNormal(size, waves) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const [fx, fy, a, ph] of waves) {
        const k = 2 * Math.PI * (fx * x + fy * y) / size + ph;
        const c = Math.cos(k) * a;
        dx += c * fx; dy += c * fy;
      }
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * .5 + .5) * 255; data[i + 1] = (n.y * .5 + .5) * 255; data[i + 2] = (n.z * .5 + .5) * 255; data[i + 3] = 255;
    }
    const tx = new THREE.DataTexture(data, size, size);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.needsUpdate = true;
    return tx;
  }
  const waves = []; for (let i = 0; i < 26; i++) waves.push([Math.floor(rnd() * 9) - 4 || 1, Math.floor(rnd() * 9) - 4 || 2, .06 + rnd() * .1, rnd() * 6.28]);
  const oceanNormal = waveNormal(256, waves);
  oceanNormal.repeat.set(40, 40);

  const asphalt = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 40 + rnd() * 40; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  });
  asphalt.repeat.set(3, 120);
  const wet = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, r = 6 + rnd() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(40,40,40,.7)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }, false);
  wet.repeat.set(3, 140);

  function facadeTextures() {
    const cols = 4, rows = 4, s = 256;
    const lit = [];
    for (let i = 0; i < cols * rows; i++) lit.push(rnd() < .4 ? (rnd() < .8 ? '#ffc47a' : '#9fe8ff') : null);
    const map = canvasTex(s, s, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = c * 64 + 14, y = r * 64 + 14;
        g.fillStyle = '#d9d2cc'; g.fillRect(x - 5, y + 40, 46, 6); // sill
        g.fillStyle = '#2b3542'; g.fillRect(x, y, 36, 38);
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 36, 10);
      }
    });
    const emis = canvasTex(s, s, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
      lit.forEach((col, i) => { if (!col) return; const x = (i % cols) * 64 + 14, y = Math.floor(i / cols) * 64 + 14; g.fillStyle = col; g.fillRect(x, y, 36, 38); });
    });
    return { map, emis };
  }
  const facades = [facadeTextures(), facadeTextures(), facadeTextures(), facadeTextures()];

  // ---------- ground ----------
  const L = 520, Z0 = 40;
  const plane = (w, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z - d / 2 + Z0); m.receiveShadow = true; scene.add(m); return m;
  };
  plane(11, L, new THREE.MeshStandardMaterial({ map: asphalt, roughnessMap: wet, roughness: 0.7, metalness: 0.05, color: 0x8a8690 }), 0, 0, 0);
  const box = (w, h, d, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
  };
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb9aca2, roughness: 0.75 });
  box(5, .18, L, concrete, 8, .09, Z0 - L / 2, false);       // right sidewalk
  box(6, .18, L, concrete, -8.5, .09, Z0 - L / 2, false);    // left promenade
  box(.4, .9, L, new THREE.MeshStandardMaterial({ color: 0xe8dccf, roughness: .7 }), -11.7, .45, Z0 - L / 2, false); // sea wall
  plane(24, L, new THREE.MeshStandardMaterial({ color: 0xd9b28a, roughness: 1 }), -23.8, .05, 0); // sand
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({
    color: 0x0d3346, roughness: 0.06, metalness: 0.4, normalMap: oceanNormal, normalScale: new THREE.Vector2(.45, .45)
  }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.set(-1236, -.1, -200); scene.add(ocean);
  plane(1200, 1200, new THREE.MeshStandardMaterial({ color: 0x3b3440, roughness: .9 }), 620, -.02, 400); // land behind buildings

  // road markings
  const paintY = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: .5, emissive: 0x2a1d00 });
  const paintW = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: .5 });
  for (let z = Z0 - 2; z > Z0 - L; z -= 8) box(.16, .02, 3.2, paintY, 0, .011, z, false);
  box(.14, .02, L, paintW, 5.1, .011, Z0 - L / 2, false);
  box(.14, .02, L, paintW, -5.1, .011, Z0 - L / 2, false);

  // ---------- buildings (art-deco hotels on the right) ----------
  const pastel = [0xf3c6d3, 0x9fdcd2, 0xf4e6cc, 0xcbb9ec, 0xf1ece4, 0xffd0a8];
  const neon = [0xff3fa4, 0x29e6ff, 0xff8a3d, 0xb84dff];
  let z = Z0 - 2;
  let bi = 0;
  while (z > Z0 - L + 40) {
    const w = 12 + rnd() * 10, h = (z > -120 ? 9 + rnd() * 12 : 14 + rnd() * 28), d = 14 + rnd() * 6;
    const f = facades[bi % 4];
    const mat = new THREE.MeshStandardMaterial({
      color: pastel[bi % pastel.length], map: f.map.clone(), emissiveMap: f.emis.clone(), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: .8
    });
    [mat.map, mat.emissiveMap].forEach(tx => { tx.needsUpdate = true; tx.repeat.set(w / 6, h / 6); });
    const x = 10.6 + d / 2;
    box(d, h, w, mat, x, h / 2, z - w / 2);
    // deco crown + neon
    const crownMat = new THREE.MeshStandardMaterial({ color: pastel[(bi + 2) % pastel.length], roughness: .7 });
    box(d * .6, 2.2, w * .35, crownMat, x, h + 1.1, z - w / 2);
    const nc = neon[bi % neon.length];
    const nmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(nc).multiplyScalar(3.2) });
    box(.12, .18, w - 1, nmat, 10.5, h - .6, z - w / 2, false);
    if (bi % 2 === 0) box(.14, h * .55, .5, nmat, 10.5, h * .55, z - 1.4, false);
    // awning
    box(1.6, .12, w - 2, new THREE.MeshStandardMaterial({ color: [0xd94c5b, 0x2f9c8f, 0x3d6fd1][bi % 3], roughness: .6 }), 9.9, 3.1, z - w / 2);
    z -= w + .6; bi++;
  }
  // distant skyline
  for (let i = 0; i < 46; i++) {
    const h = 30 + rnd() * 110, w = 10 + rnd() * 18;
    const f = facades[i % 4];
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5e78, map: f.map.clone(), emissiveMap: f.emis.clone(), emissive: 0xffffff, emissiveIntensity: 1.1, roughness: .6, metalness: .3 });
    [mat.map, mat.emissiveMap].forEach(tx => { tx.needsUpdate = true; tx.repeat.set(w / 5, h / 5); });
    box(w, h, w, mat, -60 + rnd() * 180, h / 2, -330 - rnd() * 160, false);
  }

  // ---------- palms ----------
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e5440, roughness: .95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: .75, side: THREE.DoubleSide });
  const leafGeo = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 1, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getY(i) + .5, side = p.getX(i);
      const len = u * 3.6, width = Math.sin(u * Math.PI) * .55 * (side > 0 ? 1 : -1);
      p.setXYZ(i, width, -u * u * 1.6 + Math.abs(width) * .25, -len);
    }
    g.computeVertexNormals(); return g;
  })();
  function palm(x, zz, h, lean) {
    const grp = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * .3, h * .5, 0), new THREE.Vector3(lean, h, 0)]);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, .2, 8), trunkMat); trunk.castShadow = true; grp.add(trunk);
    for (let i = 0; i < 11; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(lean, h, 0);
      leaf.rotation.set(-.25 + rnd() * .3, i * (Math.PI * 2 / 11) + rnd() * .3, 0, 'YXZ');
      leaf.scale.setScalar(1.1 + rnd() * .3);
      leaf.castShadow = true; grp.add(leaf);
    }
    grp.position.set(x, 0, zz); grp.rotation.y = rnd() * 6.28;
    scene.add(grp);
  }
  for (let zz = Z0 - 4; zz > -340; zz -= 11) palm(-8 + (rnd() - .5) * .6, zz, 8 + rnd() * 3, .6 + rnd() * .8);
  for (let zz = Z0 - 10; zz > -340; zz -= 17) palm(7.6, zz, 7 + rnd() * 3, .5 + rnd() * .6);
  // street lamps
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: .6, roughness: .4 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(4) });
  for (let zz = Z0 - 9; zz > -300; zz -= 22) {
    box(.14, 6, .14, poleMat, -6.1, 3, zz, true);
    box(1.4, .1, .14, poleMat, -5.5, 6, zz, false);
    box(.5, .12, .3, bulbMat, -4.9, 5.92, zz, false);
  }

  // ---------- car ----------
  function makeCar(color) {
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-2.25, .32); s.lineTo(-2.28, .78); s.quadraticCurveTo(-2.22, .98, -1.9, 1.0);
    s.lineTo(-1.25, 1.04); s.quadraticCurveTo(-.6, 1.4, .12, 1.36); s.quadraticCurveTo(.6, 1.32, 1.1, .97);
    s.lineTo(1.95, .84); s.quadraticCurveTo(2.32, .8, 2.32, .52); s.lineTo(2.25, .32); s.lineTo(-2.25, .32);
    const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelThickness: .16, bevelSize: .1, bevelSegments: 5, curveSegments: 28 });
    bodyGeo.translate(0, 0, -.81);
    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .55, roughness: .28, clearcoat: 1, clearcoatRoughness: .04 });
    const body = new THREE.Mesh(bodyGeo, paint); body.castShadow = body.receiveShadow = true; g.add(body);
    const w = new THREE.Shape();
    w.moveTo(-1.2, 1.02); w.quadraticCurveTo(-.6, 1.36, .12, 1.32); w.quadraticCurveTo(.58, 1.29, 1.06, .97); w.lineTo(-1.2, .99);
    const winGeo = new THREE.ExtrudeGeometry(w, { depth: 1.62, bevelEnabled: true, bevelThickness: .2, bevelSize: .135, bevelSegments: 4, curveSegments: 24 });
    winGeo.translate(0, .015, -.81);
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c0f14, metalness: .9, roughness: .04, clearcoat: 1 });
    g.add(new THREE.Mesh(winGeo, glass));
    const tire = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: .75, envMapIntensity: .2 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: .22 });
    for (const [x, zz] of [[1.45, .86], [1.45, -.86], [-1.45, .86], [-1.45, -.86]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(.37, .37, .3, 32), tire); t.rotation.x = Math.PI / 2; t.position.set(x, .37, zz); t.castShadow = true; g.add(t);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .32, 24), rim); r.rotation.x = Math.PI / 2; r.position.set(x, .37, zz); g.add(r);
    }
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1030).multiplyScalar(3) });
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(3) });
    for (const zz of [.62, -.62]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(.06, .07, .5), tail); tl.position.set(-2.32, .82, zz); g.add(tl);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(.06, .07, .42), head); hl.position.set(2.36, .66, zz); g.add(hl);
    }
    const tl2 = new THREE.Mesh(new THREE.BoxGeometry(.05, .04, 1.3), tail); tl2.position.set(-2.33, .82, 0); g.add(tl2);
    return g;
  }
  const car = makeCar(0xc4121f);
  car.position.set(3.6, 0, -9); car.rotation.y = Math.PI / 2 + .04;
  scene.add(car);
  const car2 = makeCar(0x1d3f8a);
  car2.position.set(3.7, 0, -36); car2.rotation.y = Math.PI / 2;
  scene.add(car2);

  // ---------- fighter jet ----------
  function makeJet() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x55606e, metalness: .7, roughness: .32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c313a, metalness: .5, roughness: .5 });
    const pts = [[0, 7.2], [.18, 6.6], [.42, 5.6], [.68, 4.2], [.86, 2.6], [.95, 1], [.98, -2.5], [.9, -5], [.74, -6.1], [.66, -6.3]].map(([r, y]) => new THREE.Vector2(r, y));
    const fg = new THREE.LatheGeometry(pts, 40); fg.rotateZ(-Math.PI / 2); fg.scale(1, .9, 1);
    const fus = new THREE.Mesh(fg, metal); fus.castShadow = true; g.add(fus);
    const flat = (shape, depth, mat) => { const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2 }); return new THREE.Mesh(geo, mat); };
    // wings (in x/z plane)
    for (const sgn of [1, -1]) {
      const s = new THREE.Shape();
      s.moveTo(2.2, 0); s.lineTo(-2.6, 5.6 * sgn); s.lineTo(-3.8, 5.6 * sgn); s.lineTo(-3.6, 0);
      const m = flat(s, .14, metal); m.rotation.x = Math.PI / 2; m.position.y = -.05; m.castShadow = true; g.add(m);
      const t = new THREE.Shape();
      t.moveTo(-4.4, .4 * sgn); t.lineTo(-6.0, 2.8 * sgn); t.lineTo(-6.7, 2.8 * sgn); t.lineTo(-6.4, .4 * sgn);
      const tm = flat(t, .1, metal); tm.rotation.x = Math.PI / 2; tm.position.y = -.1; tm.castShadow = true; g.add(tm);
      const f = new THREE.Shape();
      f.moveTo(-3.6, 0); f.lineTo(-5.4, 2.7); f.lineTo(-6.2, 2.7); f.lineTo(-6.3, 0);
      const fm = flat(f, .1, metal); fm.position.set(0, .4, .55 * sgn - .05); fm.rotation.x = -.32 * sgn; fm.castShadow = true; g.add(fm);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(2.6, .7, .5), dark); intake.position.set(.4, -.15, .95 * sgn); g.add(intake);
      // landing gear
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1.2), dark); strut.position.set(-1.6, -1.05, 1.3 * sgn); g.add(strut);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .22, 20), dark); wh.rotation.x = Math.PI / 2; wh.position.set(-1.6, -1.6, 1.3 * sgn); g.add(wh);
    }
    const ns = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.2), dark); ns.position.set(4.2, -1.05, 0); g.add(ns);
    const nw = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .18, 20), dark); nw.rotation.x = Math.PI / 2; nw.position.set(4.2, -1.6, 0); g.add(nw);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(.62, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0xd8a23c, metalness: 1, roughness: .08, clearcoat: 1 }));
    canopy.scale.set(2.5, 1.05, .82); canopy.position.set(3.0, .55, 0); g.add(canopy);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.62, .7, .8, 32, 1, true), dark);
    nozzle.rotation.z = Math.PI / 2; nozzle.position.set(-6.5, 0, 0); g.add(nozzle);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a4a).multiplyScalar(2.5), transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.55, 3.2, 24, 1, true), flameMat);
    flame.rotation.z = Math.PI / 2; flame.position.set(-8.4, 0, 0); g.add(flame);
    const core = new THREE.Mesh(new THREE.ConeGeometry(.3, 1.8, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fdcff).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.rotation.z = Math.PI / 2; core.position.set(-7.6, 0, 0); g.add(core);
    g.userData = { flame, core };
    return g;
  }
  const jet = makeJet();
  const JET_POS = new THREE.Vector3(-1.3, 1.75, -12);
  const JET_SCALE = 1.0;
  jet.rotation.y = -2.55;
  scene.add(jet);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .08, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9feaff).multiplyScalar(2), transparent: true }));
  ring.rotation.x = Math.PI / 2; ring.position.set(JET_POS.x, .2, JET_POS.z); scene.add(ring);
  const burst = new THREE.PointLight(0xa8e8ff, 0, 60, 1.5); burst.position.set(JET_POS.x, 4, JET_POS.z); scene.add(burst);

  // ---------- camera + post ----------
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, .1, 3000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(800, 450), .42, .5, .95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let curW = 0, curH = 0;
  function size(w, h) {
    if (w === curW && h === curH) return;
    curW = w; curH = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  let jetHidden = false;
  function frame(t, target) {
    // shared animation
    oceanNormal.offset.set(t * .012, t * .02);
    const sp = seg(t, 4.95, 5.55);
    jet.visible = t >= 4.95 && !jetHidden;
    jet.scale.setScalar(Math.max(.001, back(sp)) * JET_SCALE);
    jet.position.copy(JET_POS); jet.position.y += (1 - eout(sp)) * 6 + Math.sin(t * 2.4) * .06;
    const fl = .85 + .18 * Math.sin(t * 47) + .1 * Math.sin(t * 29);
    jet.userData.flame.scale.set(1, fl, 1); jet.userData.core.scale.set(1, fl, 1);
    const rp = seg(t, 4.95, 5.8);
    ring.visible = rp > 0 && rp < 1;
    ring.scale.setScalar(1 + eout(rp) * 16); ring.material.opacity = 1 - rp;
    burst.intensity = t >= 4.95 ? 260 * Math.max(0, 1 - (t - 4.95) / .6) : 0;
    // keep shadow camera around the action
    const focus = camera.position.clone().add(new THREE.Vector3(0, 0, -22));
    sunLight.target.position.copy(focus);
    sunLight.position.copy(focus).addScaledVector(lightDir, 120);
    composer.render();
    const ctx = target.getContext('2d');
    ctx.drawImage(renderer.domElement, 0, 0, target.width, target.height);
  }
  return {
    renderGame(t, target) {
      size(target.width, target.height);
      camera.fov = 48;
      const drift = eio(seg(t, 0, 10)) * 6;
      camera.position.set(.6 + Math.sin(t * .4) * .15, 3.1, 14 - drift);
      camera.lookAt(-.6, 2.0, -40);
      frame(t, target);
    },
    renderIntro(t, target) {
      size(target.width, target.height);
      camera.fov = 40;
      const p = eio(seg(t, 10.3, 19));
      const cx = car.position.x, cz = car.position.z;
      camera.position.set(cx - 6.8 + p * .6, 1.0 + p * .3, cz - 6.5 + p * 2.2);
      camera.lookAt(cx + 1.5, 2.6, cz - .5);
      jetHidden = true;
      frame(t, target);
      jetHidden = false;
    },
  };
}
