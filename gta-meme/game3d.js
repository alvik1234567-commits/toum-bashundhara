// Real-time 3D "game" scene for the TV and the intro shot (opt-in: ?style=3d).
// Everything is procedural (no downloaded assets) and driven by time t, so frames are deterministic.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eout = x => 1 - Math.pow(1 - x, 3);
const eio = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const back = x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function createGame3D() {
  let seed = 1234;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xb0607c, 0.0021);

  // ================= SKY =================
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(87.6), THREE.MathUtils.degToRad(203));
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float toward = max(dot(normalize(vec3(d.x,0.,d.z)), normalize(vec3(sunDir.x,0.,sunDir.z))), 0.);
        vec3 zenith = vec3(0.04, 0.06, 0.24);
        vec3 mid = vec3(0.36, 0.14, 0.44);
        vec3 low = mix(vec3(0.9, 0.28, 0.36), vec3(1.5, 0.58, 0.2), toward);
        vec3 hor = mix(vec3(0.9, 0.38, 0.38), vec3(1.3, 0.6, 0.26), pow(toward, 3.));
        vec3 c = h > 0.25 ? mix(mid, zenith, smoothstep(.25, .8, h)) :
                 h > 0.07 ? mix(low, mid, smoothstep(.07, .25, h)) :
                 mix(hor, low, smoothstep(0., .07, h));
        if (h < 0.) c = mix(hor, vec3(0.25, 0.12, 0.2), smoothstep(0., -0.15, h));
        float s = max(dot(d, normalize(sunDir)), 0.);
        c += vec3(2.2, 1.1, 0.4) * pow(s, 160.) + vec3(.8, .3, .1) * pow(s, 16.) * .25;
        c += vec3(12., 9., 5.) * smoothstep(0.99965, 0.9998, s);
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
  scene.environmentIntensity = 0.7;

  const sunLight = new THREE.DirectionalLight(0xffae70, 3.8);
  const lightDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(206));
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
  sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(0x7c6ad0, 0x30202a, 0.42));
  const fill = new THREE.DirectionalLight(0xb9c4ff, 1.1); fill.position.set(6, 8, 30); scene.add(fill);  // soft camera-side fill

  // ================= TEXTURE HELPERS =================
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tx = new THREE.CanvasTexture(c);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  }
  const cloneRep = (tx, rx, ry) => { const c = tx.clone(); c.needsUpdate = true; c.repeat.set(rx, ry); return c; };

  // ---- clouds ----
  function cloudTex() {
    return canvasTex(512, 256, (g, w, h) => {
      for (let i = 0; i < 260; i++) {
        const x = w / 2 + gauss() * w * .42, y = h * .55 + gauss() * h * .16 - Math.abs(x - w / 2) * .05;
        const r = 14 + rnd() * 46;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const a = .05 + rnd() * .1;
        gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    });
  }
  const cloudTexs = [cloudTex(), cloudTex(), cloudTex()];
  for (let i = 0; i < 18; i++) {
    const az = THREE.MathUtils.degToRad(150 + rnd() * 110), el = THREE.MathUtils.degToRad(3 + rnd() * 16);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - el, az);
    const toward = clamp(dir.clone().setY(0).normalize().dot(sunDir.clone().setY(0).normalize()));
    const col = new THREE.Color().setRGB(1.0 + toward * 1.3, .45 + toward * .55, .5 + toward * .05).multiplyScalar(.85 + (1 - el / .33) * .3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: cloudTexs[i % 3], color: col, transparent: true, depthWrite: false, fog: false, opacity: .9
    }));
    m.position.copy(dir.multiplyScalar(800));
    m.scale.set(260 + rnd() * 260, 80 + rnd() * 60, 1);
    m.lookAt(0, m.position.y * .6, 0);
    m.renderOrder = -1;
    scene.add(m);
  }

  // ---- ocean ----
  function waveNormal(size, waves) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const [fx, fy, a, ph] of waves) {
        const k = 2 * Math.PI * (fx * x + fy * y) / size + ph;
        const c = Math.cos(k) * a; dx += c * fx; dy += c * fy;
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

  // ---- road ----
  const asphalt = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) { const v = 38 + rnd() * 44; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
    g.strokeStyle = 'rgba(20,20,22,.5)'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = rnd() * w, y = 0; g.moveTo(x, y); while (y < h) { x += (rnd() - .5) * 14; y += 12; g.lineTo(x, y); } g.stroke(); }
  });
  asphalt.repeat.set(3, 120);
  const wet = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const x = rnd() * w, y = rnd() * h, rx = 3 + rnd() * 14, ry = 20 + rnd() * 90;
      g.fillStyle = `rgba(40,40,40,${.08 + rnd() * .18})`;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
    }
  }, false);
  wet.repeat.set(3, 40);

  // ---- art-deco facade ----
  function facadeTextures() {
    const S = 512, cols = 4, rows = 4, cw = S / cols, rh = S / rows;
    const lit = [];
    for (let i = 0; i < cols * rows; i++) lit.push(rnd() < .26 ? (rnd() < .85 ? '#ffbd73' : '#a8e6ff') : null);
    const map = canvasTex(S, S, (g) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(120,100,90,${rnd() * .05})`; g.fillRect(rnd() * S, rnd() * S, 3 + rnd() * 8, 3 + rnd() * 8); }
      for (let r = 0; r < rows; r++) {
        const y0 = r * rh;
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y0 + 8, S, 6);                   // eyebrow shadow
        for (let c = 0; c < cols; c++) {
          const x = c * cw + cw * .2, y = y0 + 26, ww = cw * .6, hh = rh * .56;
          g.fillStyle = '#e8e2dc'; g.fillRect(x - 6, y - 6, ww + 12, hh + 12);        // frame
          const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, '#5b6b80'); gr.addColorStop(1, '#1d2430');
          g.fillStyle = gr; g.fillRect(x, y, ww, hh);                                    // glass
          g.fillStyle = '#e8e2dc'; g.fillRect(x + ww / 2 - 2, y, 4, hh); g.fillRect(x, y + hh * .35, ww, 3); // mullions
          g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + ww * .5, y); g.lineTo(x, y + hh * .6); g.fill();
        }
      }
      g.fillStyle = 'rgba(255,255,255,.35)'; for (let c = 0; c <= cols; c++) g.fillRect(c * cw - 3, 0, 6, S); // pilasters
    });
    const emis = canvasTex(S, S, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      lit.forEach((col, i) => {
        if (!col) return;
        const c = i % cols, r = Math.floor(i / cols);
        const x = c * cw + cw * .2, y = r * rh + 26, ww = cw * .6, hh = rh * .56;
        const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, col); gr.addColorStop(1, '#7a4a20');
        g.fillStyle = gr; g.fillRect(x, y, ww, hh);
        g.fillStyle = '#000'; g.fillRect(x + ww / 2 - 2, y, 4, hh); g.fillRect(x, y + hh * .35, ww, 3);
      });
    });
    return { map, emis };
  }
  const facades = [facadeTextures(), facadeTextures(), facadeTextures(), facadeTextures()];
  const towerTex = (() => {
    const S = 256;
    const emis = canvasTex(S, S, g => {
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      for (let y = 4; y < S; y += 8) for (let x = 3; x < S; x += 8) if (rnd() < .14) { g.fillStyle = rnd() < .8 ? '#ffcf8a' : '#bfe9ff'; g.fillRect(x, y, 5, 4); }
    });
    const map = canvasTex(S, S, g => {
      g.fillStyle = '#8a93a8'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#5a6278'; for (let y = 0; y < S; y += 8) g.fillRect(0, y, S, 2);
      g.fillStyle = '#6a7288'; for (let x = 0; x < S; x += 8) g.fillRect(x, 0, 1, S);
    });
    return { map, emis };
  })();
  function signTex(word, col) {
    return canvasTex(128, 640, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.font = '900 96px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const step = h / (word.length + .4);
      [...word].forEach((ch, i) => { g.shadowColor = col; g.shadowBlur = 16; g.fillStyle = col; g.fillText(ch, w / 2, step * (i + .7)); g.shadowBlur = 0; g.fillStyle = '#fff'; g.fillText(ch, w / 2, step * (i + .7)); });
    });
  }
  const shopTex = canvasTex(512, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffcf8a'); gr.addColorStop(1, '#7a3a1a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) { const x = rnd() * w; const gg = g.createRadialGradient(x, h * .9, 0, x, h * .9, 40); gg.addColorStop(0, 'rgba(40,15,5,.55)'); gg.addColorStop(1, 'rgba(40,15,5,0)'); g.fillStyle = gg; g.fillRect(x - 40, h * .5, 80, h * .5); }
    g.fillStyle = '#1a1210'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 8, h);
    g.fillRect(0, 0, w, 8);
  });

  // ---- palm leaf + bark ----
  const leafTex = canvasTex(256, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    for (let y = 30; y < h - 10; y += 6) {
      const u = y / h;
      const len = Math.sin(u * Math.PI) * (w * .47) * (0.55 + .45 * u);
      const shade = 60 + Math.floor(rnd() * 40);
      g.strokeStyle = `rgb(${40 + shade * .3},${80 + shade},${40 + shade * .2})`; g.lineWidth = 11;
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * len * .5, y - 10, cx + s * len, y - 24 - u * 20); g.stroke();
      }
    }
    g.strokeStyle = '#6b6a3a'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
  });
  const barkTex = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#7a6048'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 10) { g.fillStyle = `rgba(40,28,18,${.35 + rnd() * .3})`; g.fillRect(0, y, w, 3 + rnd() * 2); }
    for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(160,140,110,${rnd() * .25})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  });

  // ---- jet panels ----
  const panelTex = canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${rnd() < .5 ? 0 : 255},${rnd() < .5 ? 0 : 255},255,${rnd() * .03})`; g.fillRect(rnd() * w, rnd() * h, 20 + rnd() * 80, 10 + rnd() * 40); }
    g.strokeStyle = 'rgba(40,46,56,.55)'; g.lineWidth = 2;
    let x = 0; while (x < w) { x += 40 + rnd() * 90; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    let y = 0; while (y < h) { y += 30 + rnd() * 70; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(30,34,40,.5)'; for (let i = 0; i < 900; i++) g.fillRect(rnd() * w, rnd() * h, 2, 2);
  });

  // ================= WORLD =================
  const L = 520, Z0 = 40;
  const plane = (w, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z - d / 2 + Z0); m.receiveShadow = true; scene.add(m); return m;
  };
  const box = (w, h, d, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
  };
  plane(11, L, new THREE.MeshStandardMaterial({ map: asphalt, roughnessMap: wet, roughness: 0.72, metalness: 0.06, color: 0x86828c }), 0, 0, 0);
  const pavers = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c9bcb0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,80,70,.5)'; g.lineWidth = 2;
    for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(60,50,40,${rnd() * .08})`; g.fillRect(rnd() * w, rnd() * h, 4, 4); }
  });
  const walk = new THREE.MeshStandardMaterial({ map: cloneRep(pavers, 2.5, 260), roughness: .8 });
  box(5, .18, L, walk, 8, .09, Z0 - L / 2, false);
  box(6, .18, L, new THREE.MeshStandardMaterial({ map: cloneRep(pavers, 3, 260), roughness: .8 }), -8.5, .09, Z0 - L / 2, false);
  box(.4, .9, L, new THREE.MeshStandardMaterial({ color: 0xe8dccf, roughness: .7 }), -11.7, .45, Z0 - L / 2, false);
  box(.25, .2, L, new THREE.MeshStandardMaterial({ color: 0xd8d0c8, roughness: .7 }), 5.55, .1, Z0 - L / 2, false);  // curb
  box(.25, .2, L, new THREE.MeshStandardMaterial({ color: 0xd8d0c8, roughness: .7 }), -5.55, .1, Z0 - L / 2, false);
  const sand = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d8b08a'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6000; i++) { const v = rnd() * 40 - 20; g.fillStyle = `rgb(${216 + v},${176 + v},${138 + v})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); } });
  plane(24, L, new THREE.MeshStandardMaterial({ map: cloneRep(sand, 6, 120), roughness: 1 }), -23.8, .05, 0);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({
    color: 0x0b2c3e, roughness: 0.14, metalness: 0.45, normalMap: oceanNormal, normalScale: new THREE.Vector2(.5, .5)
  }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.set(-1236, -.1, -200); scene.add(ocean);
  plane(1200, 1200, new THREE.MeshStandardMaterial({ color: 0x3b3440, roughness: .9 }), 620, -.02, 400);

  const paintY = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: .5 });
  const paintW = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: .5 });
  for (let z = Z0 - 2; z > Z0 - L; z -= 8) box(.16, .02, 3.2, paintY, 0, .011, z, false);
  box(.14, .02, L, paintW, 5.1, .011, Z0 - L / 2, false);
  box(.14, .02, L, paintW, -5.1, .011, Z0 - L / 2, false);

  // ---- hotels ----
  const pastel = [0xf3c6d3, 0x9fdcd2, 0xf4e6cc, 0xcbb9ec, 0xf1ece4, 0xffd0a8];
  const neon = ['#ff3fa4', '#29e6ff', '#ff8a3d', '#c35cff'];
  const words = ['HOTEL', 'PALMS', 'SUNSET', 'OCEAN', 'CORAL', 'BREEZE', 'LUNA', 'MARINA'];
  let z = Z0 - 2, bi = 0;
  while (z > Z0 - L + 40) {
    const w = 13 + rnd() * 9, floors = z > -120 ? 3 + Math.floor(rnd() * 4) : 5 + Math.floor(rnd() * 8), h = floors * 3.2 + 1, d = 14 + rnd() * 6;
    const f = facades[bi % 4];
    const col = pastel[bi % pastel.length];
    const mat = new THREE.MeshStandardMaterial({ color: col, map: cloneRep(f.map, w / 12, h / 12.8), emissiveMap: cloneRep(f.emis, w / 12, h / 12.8), emissive: 0xffffff, emissiveIntensity: .9, roughness: .85 });
    const x0 = 10.6, x = x0 + d / 2, zc = z - w / 2;
    box(d, h, w, mat, x, h / 2, zc);
    const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(col).offsetHSL(0, -.1, .08), roughness: .7 });
    for (let fl = 1; fl < floors; fl++) box(.5, .22, w + .2, trim, x0 - .2, fl * 3.2 + .9, zc);   // eyebrow ledges
    box(.9, .5, w + .6, trim, x0 - .3, h, zc);                                                 // cornice
    if (bi % 3 !== 1) {                                                                        // rounded corner tower
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, h + 2.4, 32), new THREE.MeshStandardMaterial({ color: col, map: cloneRep(f.map, 1, (h + 2.4) / 12.8), emissiveMap: cloneRep(f.emis, 1, (h + 2.4) / 12.8), emissive: 0xffffff, emissiveIntensity: .9, roughness: .85 }));
      cyl.position.set(x0 + 1.2, (h + 2.4) / 2, z - 1.1); cyl.castShadow = cyl.receiveShadow = true; scene.add(cyl);
    }
    box(d * .5, 2.6, w * .3, trim, x, h + 1.3, zc);                                             // deco crown
    box(d * .25, 3.6, w * .12, trim, x, h + 2.4, zc);
    // storefront
    box(.3, 2.7, w - 1.2, new THREE.MeshStandardMaterial({ color: 0x111111, map: cloneRep(shopTex, Math.ceil(w / 4), 1), emissiveMap: cloneRep(shopTex, Math.ceil(w / 4), 1), emissive: 0xffffff, emissiveIntensity: .8, roughness: .2, metalness: .3 }), x0 - .1, 1.45, zc, false);
    box(1.7, .1, w - 1.6, new THREE.MeshStandardMaterial({ color: [0xd94c5b, 0x2f9c8f, 0x3d6fd1, 0xf2a03d][bi % 4], roughness: .6 }), x0 - .9, 3.05, zc);
    // neon
    const nc = neon[bi % neon.length];
    const nmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(nc).multiplyScalar(3) });
    box(.1, .14, w - 1, nmat, x0 - .05, h - .5, zc, false);
    if (bi % 2 === 0) {
      const sm = new THREE.MeshBasicMaterial({ map: signTex(words[(bi / 2) % words.length], nc) });
      sm.color.setScalar(2.2);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, Math.min(h * .55, 9), .3), [nmat, nmat, nmat, nmat, sm, sm]);
      sign.rotation.y = Math.PI / 2; sign.position.set(x0 - .9, 3.6 + Math.min(h * .55, 9) / 2, z - 2.2); scene.add(sign);
    }
    z -= w + .6; bi++;
  }
  for (let i = 0; i < 46; i++) {
    const h = 30 + rnd() * 110, w = 10 + rnd() * 18;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a7290, map: cloneRep(towerTex.map, w / 20, h / 40), emissiveMap: cloneRep(towerTex.emis, w / 20, h / 40), emissive: 0xffffff, emissiveIntensity: .9, roughness: .3, metalness: .55 });
    box(w, h, w, mat, -60 + rnd() * 180, h / 2, -330 - rnd() * 160, false);
  }

  // ---- palms ----
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: .95 });
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: .45, side: THREE.DoubleSide, roughness: .7, color: 0xd8e8c0 });
  const leafDepth = new THREE.MeshDepthMaterial({ map: leafTex, alphaTest: .45, depthPacking: THREE.RGBADepthPacking });
  const leafGeo = (() => {
    const g = new THREE.PlaneGeometry(1, 1, 4, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getY(i) + .5, side = p.getX(i);
      const len = u * 3.8, width = side * 1.5;
      p.setXYZ(i, width, -u * u * 1.9 + Math.abs(width) * .35, -len);
    }
    g.computeVertexNormals(); return g;
  })();
  function palm(x, zz, h, lean) {
    const grp = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * .3, h * .5, 0), new THREE.Vector3(lean, h, 0)]);
    const tg = new THREE.TubeGeometry(curve, 20, .2, 10);
    const trunk = new THREE.Mesh(tg, trunkMat); trunk.castShadow = true; grp.add(trunk);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.customDepthMaterial = leafDepth;
      leaf.position.set(lean, h, 0);
      leaf.rotation.set(-.35 + rnd() * .5, i * (Math.PI * 2 / n) + rnd() * .3, (rnd() - .5) * .3, 'YXZ');
      leaf.scale.setScalar(.95 + rnd() * .35);
      leaf.castShadow = true; grp.add(leaf);
    }
    grp.position.set(x, 0, zz); grp.rotation.y = rnd() * 6.28;
    scene.add(grp);
  }
  for (let zz = Z0 - 4; zz > -340; zz -= 11) palm(-8 + (rnd() - .5) * .6, zz, 8 + rnd() * 3, .6 + rnd() * .8);
  for (let zz = Z0 - 10; zz > -340; zz -= 17) palm(7.6, zz, 7 + rnd() * 3, .5 + rnd() * .6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: .6, roughness: .4 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd08a).multiplyScalar(4) });
  for (let zz = Z0 - 9; zz > -300; zz -= 22) {
    box(.14, 6, .14, poleMat, -6.1, 3, zz, true);
    box(1.4, .1, .14, poleMat, -5.5, 6, zz, false);
    box(.5, .12, .3, bulbMat, -4.9, 5.92, zz, false);
  }

  // ================= CAR =================
  function taper(geo) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      let zz = p.getZ(i);
      zz *= 1 - .22 * sstep(.92, 1.42, y);                          // narrower cabin
      zz *= 1 - .16 * Math.pow(Math.min(1, Math.abs(x) / 2.45), 6);   // rounded nose/tail in plan
      p.setZ(i, zz);
    }
    geo.computeVertexNormals();
  }
  function makeCar(color) {
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-2.25, .3); s.lineTo(-2.3, .72); s.quadraticCurveTo(-2.24, .96, -1.9, .99);
    s.lineTo(-1.25, 1.03); s.quadraticCurveTo(-.6, 1.38, .1, 1.35); s.quadraticCurveTo(.6, 1.31, 1.12, .95);
    s.lineTo(1.98, .8); s.quadraticCurveTo(2.36, .74, 2.36, .5); s.lineTo(2.28, .3); s.lineTo(-2.25, .3);
    const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelThickness: .17, bevelSize: .1, bevelSegments: 6, curveSegments: 32 });
    bodyGeo.translate(0, 0, -.81); taper(bodyGeo);
    const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .6, roughness: .26, clearcoat: 1, clearcoatRoughness: .1 });
    const body = new THREE.Mesh(bodyGeo, paint); body.castShadow = body.receiveShadow = true; g.add(body);
    const w = new THREE.Shape();
    w.moveTo(-1.2, 1.01); w.quadraticCurveTo(-.6, 1.34, .1, 1.31); w.quadraticCurveTo(.58, 1.28, 1.08, .95); w.lineTo(-1.2, .98);
    const winGeo = new THREE.ExtrudeGeometry(w, { depth: 1.62, bevelEnabled: true, bevelThickness: .2, bevelSize: .135, bevelSegments: 4, curveSegments: 24 });
    winGeo.translate(0, .015, -.81); taper(winGeo);
    g.add(new THREE.Mesh(winGeo, new THREE.MeshPhysicalMaterial({ color: 0x0a0d12, metalness: .9, roughness: .1, clearcoat: 1, clearcoatRoughness: .1 })));
    const archMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x080809, roughness: .8, envMapIntensity: .15 });
    const rim = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, metalness: 1, roughness: .18 });
    for (const [x, zz] of [[1.45, .84], [1.45, -.84], [-1.45, .84], [-1.45, -.84]]) {
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(.47, .47, .12, 32, 1, false, 0, Math.PI), archMat);
      arch.rotation.set(Math.PI / 2, 0, Math.PI / 2); arch.position.set(x, .38, zz * 1.13); g.add(arch);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(.37, .37, .3, 36), tire); t.rotation.x = Math.PI / 2; t.position.set(x, .37, zz); t.castShadow = true; g.add(t);
      const sideZ = zz + Math.sign(zz) * .16;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .03, 28), rim); r.rotation.x = Math.PI / 2; r.position.set(x, .37, sideZ); g.add(r);
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(.05, .22, .03), rim);
        sp.position.set(x, .37, sideZ + Math.sign(zz) * .02); sp.rotation.z = k * Math.PI * 2 / 5;
        sp.translateY(.11); g.add(sp);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .04, 24), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: .8, roughness: .4 }));
      hub.rotation.x = Math.PI / 2; hub.position.set(x, .37, sideZ - Math.sign(zz) * .01); g.add(hub);
    }
    for (const zz of [.95, -.95]) { const m = new THREE.Mesh(new THREE.BoxGeometry(.18, .1, .16), paint); m.position.set(.95, 1.0, zz); g.add(m); }
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1030).multiplyScalar(3) });
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(3) });
    for (const zz of [.55, -.55]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .5), tail); tl.position.set(-2.33, .8, zz); g.add(tl);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(.06, .06, .4), head); hl.position.set(2.38, .64, zz); g.add(hl);
    }
    const tl2 = new THREE.Mesh(new THREE.BoxGeometry(.05, .03, 1.1), tail); tl2.position.set(-2.34, .8, 0); g.add(tl2);
    return g;
  }
  const car = makeCar(0xc4121f);
  car.position.set(3.6, 0, -4); car.rotation.y = Math.PI / 2 + .04; scene.add(car);
  [[0x1d3f8a, -36], [0xe8e4dc, -58], [0x111114, -80], [0xf2b134, -104]].forEach(([c, zz]) => {
    const k = makeCar(c); k.position.set(3.7, 0, zz); k.rotation.y = Math.PI / 2; scene.add(k);
  });

  // ================= JET =================
  function makeJet() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, map: panelTex, metalness: .55, roughness: .3, envMapIntensity: 1.6 });
    const wingMetal = new THREE.MeshStandardMaterial({ color: 0xb4bcc6, map: cloneRep(panelTex, .3, .3), metalness: .55, roughness: .32, envMapIntensity: 1.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c313a, metalness: .5, roughness: .5 });
    const pts = [[0, 7.2], [.18, 6.6], [.42, 5.6], [.68, 4.2], [.86, 2.6], [.95, 1], [.98, -2.5], [.9, -5], [.74, -6.1], [.66, -6.3]].map(([r, y]) => new THREE.Vector2(r, y));
    const fg = new THREE.LatheGeometry(pts, 48); fg.rotateZ(-Math.PI / 2); fg.scale(1, .9, 1);
    const fus = new THREE.Mesh(fg, metal); fus.castShadow = true; g.add(fus);
    const radome = new THREE.Mesh(new THREE.LatheGeometry(pts.slice(0, 3).map(v => new THREE.Vector2(v.x * 1.01, v.y)), 48), new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: .5, metalness: .3 }));
    radome.geometry.rotateZ(-Math.PI / 2); radome.geometry.scale(1, .9, 1); g.add(radome);
    const flat = (shape, depth, mat) => { const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 2 }); return new THREE.Mesh(geo, mat); };
    const missileMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: .5 });
    for (const sgn of [1, -1]) {
      const s = new THREE.Shape();
      s.moveTo(2.2, 0); s.lineTo(-2.6, 5.6 * sgn); s.lineTo(-3.8, 5.6 * sgn); s.lineTo(-3.6, 0);
      const m = flat(s, .12, wingMetal); m.rotation.x = Math.PI / 2; m.position.y = -.05; m.castShadow = true; g.add(m);
      const t = new THREE.Shape();
      t.moveTo(-4.4, .4 * sgn); t.lineTo(-6.0, 2.8 * sgn); t.lineTo(-6.7, 2.8 * sgn); t.lineTo(-6.4, .4 * sgn);
      const tm = flat(t, .08, wingMetal); tm.rotation.x = Math.PI / 2; tm.position.y = -.1; tm.castShadow = true; g.add(tm);
      const f = new THREE.Shape();
      f.moveTo(-3.6, 0); f.lineTo(-5.4, 2.7); f.lineTo(-6.2, 2.7); f.lineTo(-6.3, 0);
      const fm = flat(f, .08, wingMetal); fm.position.set(0, .4, .55 * sgn - .04); fm.rotation.x = -.32 * sgn; fm.castShadow = true; g.add(fm);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(2.6, .7, .5), dark); intake.position.set(.4, -.15, .95 * sgn); g.add(intake);
      // missiles
      for (const [mx, mz] of [[-1.4, 3.2], [-2.4, 5.0]]) {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 2.4, 12), missileMat); body.rotation.z = Math.PI / 2; body.position.set(mx, -.32, mz * sgn); g.add(body);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(.09, .4, 12), missileMat); tip.rotation.z = -Math.PI / 2; tip.position.set(mx + 1.4, -.32, mz * sgn); g.add(tip);
      }
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1.2), dark); strut.position.set(-1.6, -1.05, 1.3 * sgn); g.add(strut);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .22, 20), dark); wh.rotation.x = Math.PI / 2; wh.position.set(-1.6, -1.6, 1.3 * sgn); g.add(wh);
    }
    const ns = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.2), dark); ns.position.set(4.2, -1.05, 0); g.add(ns);
    const nw = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .18, 20), dark); nw.rotation.x = Math.PI / 2; nw.position.set(4.2, -1.6, 0); g.add(nw);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(.62, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0xd8a23c, metalness: 1, roughness: .14, clearcoat: 1, clearcoatRoughness: .12 }));
    canopy.scale.set(2.5, 1.05, .82); canopy.position.set(3.0, .55, 0); g.add(canopy);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(.6, .03, 6, 32, Math.PI), dark); frame.scale.set(1, 1.05, .82); frame.position.set(2.6, .55, 0); frame.rotation.y = Math.PI / 2; g.add(frame);
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
  const JET_POS = new THREE.Vector3(.4, 1.75, -17);
  jet.rotation.y = -2.15;
  scene.add(jet);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .08, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9feaff).multiplyScalar(2), transparent: true }));
  ring.rotation.x = Math.PI / 2; ring.position.set(JET_POS.x, .2, JET_POS.z); scene.add(ring);
  const burst = new THREE.PointLight(0xa8e8ff, 0, 60, 1.5); burst.position.set(JET_POS.x, 4, JET_POS.z); scene.add(burst);

  // ================= CAMERA + POST =================
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, .1, 3000);
  const rt = new THREE.WebGLRenderTarget(1920, 1080, { type: THREE.FloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(960, 540), .45, .5, .95));
  composer.addPass(new OutputPass());
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = mix(c, c * c * (3. - 2. * c), .3);
        float l = dot(c, vec3(.299, .587, .114));
        c += vec3(-.02, .012, .035) * (1. - l) + vec3(.03, .008, -.03) * l;
        c = mix(vec3(l), c, 1.1);
        vec2 d = vUv - .5; c *= 1. - dot(d, d) * .85;
        c += (hash(vUv * 1024. + fract(time) * 37.) - .5) * .03;
        gl_FragColor = vec4(c, 1.);
      }`
  });
  composer.addPass(grade);
  let curW = 0, curH = 0;
  function size(w, h) {
    if (w === curW && h === curH) return;
    curW = w; curH = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  let jetHidden = false;
  function frame(t, target) {
    oceanNormal.offset.set(t * .012, t * .02);
    grade.uniforms.time.value = t;
    const sp = seg(t, 4.95, 5.55);
    jet.visible = t >= 4.95 && !jetHidden;
    jet.scale.setScalar(Math.max(.001, back(sp)));
    jet.position.copy(JET_POS); jet.position.y += (1 - eout(sp)) * 6 + Math.sin(t * 2.4) * .06;
    const fl = .85 + .18 * Math.sin(t * 47) + .1 * Math.sin(t * 29);
    jet.userData.flame.scale.set(1, fl, 1); jet.userData.core.scale.set(1, fl, 1);
    const rp = seg(t, 4.95, 5.8);
    ring.visible = rp > 0 && rp < 1 && !jetHidden;
    ring.scale.setScalar(1 + eout(rp) * 16); ring.material.opacity = 1 - rp;
    burst.intensity = t >= 4.95 && !jetHidden ? 260 * Math.max(0, 1 - (t - 4.95) / .6) : 0;
    const focus = camera.position.clone().add(new THREE.Vector3(0, 0, -20));
    sunLight.target.position.copy(focus);
    sunLight.position.copy(focus).addScaledVector(lightDir, 120);
    composer.render();
    target.getContext('2d').drawImage(renderer.domElement, 0, 0, target.width, target.height);
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
      camera.fov = 38;
      const p = eio(seg(t, 10.3, 19));
      // hero shot of the spawned jet, low and in front of its nose
      const jx = JET_POS.x, jz = JET_POS.z;
      camera.position.set(jx - 9.5 + p * 1.2, 1.1 + p * .3, jz + 7.5 - p * 1.5);
      camera.lookAt(jx + .5, 2.6, jz - 1);
      ring.visible = false;
      frame(t, target);
    },
  };
}
