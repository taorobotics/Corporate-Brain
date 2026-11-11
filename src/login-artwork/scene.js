import * as THREE from "three";

// Original procedural scene: no image loaders, remote assets, logos or lettering.
export function createPlanetScene(host, root) {
  const finePointer = matchMedia("(hover:hover) and (pointer:fine)");
  const reduced = matchMedia("(prefers-reduced-motion:reduce)");
  let renderer,
    scene,
    camera,
    world,
    ringGroup,
    body,
    moon,
    amber,
    orbiter,
    stars,
    envTarget;
  let raf = 0,
    lastTick = 0,
    lastRender = 0,
    time = 0,
    frames = 0,
    running = false,
    disposed = false;
  const pointer = { x: 0, y: 0 },
    view = { x: 0, y: 0 },
    resources = new Set();
  const state = {
    mode: "initializing",
    frames: 0,
    time: 0,
    paused: true,
    error: null,
    pointer: { x: 0, y: 0 },
  };

  function remember(resource) {
    resources.add(resource);
    return resource;
  }
  function mesh(geometry, material, parent = world) {
    const object = new THREE.Mesh(remember(geometry), remember(material));
    parent.add(object);
    return object;
  }
  function physical(parameters) {
    return new THREE.MeshPhysicalMaterial(parameters);
  }
  function makeAnnulus(inner, outer, material) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    return mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.025,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.008,
        bevelThickness: 0.007,
        curveSegments: 96,
      }),
      material,
      ringGroup,
    );
  }
  function studioEnvironment() {
    const room = new THREE.Scene();
    room.background = new THREE.Color(0x8994a0);
    const boxes = [];
    for (const [position, size, color] of [
      [
        [-3, 4, 5],
        [5, 3],
        [4.8, 4.6, 4.3],
      ],
      [
        [4, 1, 3],
        [2.2, 5],
        [2.4, 3.0, 4.0],
      ],
      [
        [-4, -1, -3],
        [1.5, 4],
        [2.5, 1.9, 1.4],
      ],
      [
        [1, 4, -5],
        [4, 1],
        [2.8, 3.0, 3.2],
      ],
    ]) {
      const geo = new THREE.PlaneGeometry(...size),
        mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(...color),
          side: THREE.DoubleSide,
        });
      const box = new THREE.Mesh(geo, mat);
      box.position.set(...position);
      box.lookAt(0, 0, 0);
      room.add(box);
      boxes.push(box);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTarget = pmrem.fromScene(room, 0.025);
    scene.environment = envTarget.texture;
    for (const box of boxes) {
      box.geometry.dispose();
      box.material.dispose();
    }
    pmrem.dispose();
  }
  function shadowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d"),
      gradient = ctx.createRadialGradient(128, 64, 0, 128, 64, 120);
    gradient.addColorStop(0, "rgba(47,58,70,.24)");
    gradient.addColorStop(0.4, "rgba(47,58,70,.10)");
    gradient.addColorStop(1, "rgba(47,58,70,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 128);
    return remember(new THREE.CanvasTexture(canvas));
  }
  function setup() {
    const canvas = document.createElement("canvas");
    let context;
    try {
      context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {}
    if (!context) {
      fallback("3D is unavailable on this device");
      return;
    }
    renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    renderer.domElement.className = "planet-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setClearColor(0xeeeae0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-2.5, 2.5, 2.5, -2.5, 0.1, 30);
    camera.position.set(0, 0.3, 8);
    camera.lookAt(0, 0.06, 0);
    world = new THREE.Group();
    world.position.y = 0.12;
    scene.add(world);
    studioEnvironment();
    const key = new THREE.DirectionalLight(0xfff4e2, 2);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9dfff, 1.1);
    fill.position.set(4, 1, 1);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 2.2);
    rim.position.set(1, 3, -4);
    scene.add(rim);
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb6b2a7, 0.6);
    scene.add(hemisphere);
    scene.userData.lights = { key, fill, rim, hemisphere };

    body = mesh(
      new THREE.SphereGeometry(0.98, 64, 48),
      physical({
        color: 0xf4f6ff,
        metalness: 0,
        roughness: 0.07,
        transmission: 1,
        thickness: 1.2,
        attenuationColor: 0xb9cee8,
        attenuationDistance: 1.7,
        ior: 1.4,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        iridescence: 0.38,
        iridescenceIOR: 1.33,
        iridescenceThicknessRange: [240, 520],
        envMapIntensity: 1.05,
      }),
    );
    // A soft inner body gives the outer glass optical depth instead of a hollow shell.
    mesh(
      new THREE.SphereGeometry(0.64, 48, 32),
      physical({
        color: 0xd3d7e9,
        roughness: 0.3,
        metalness: 0.12,
        envMapIntensity: 0.65,
        clearcoat: 0.3,
        iridescence: 0.4,
      }),
    );
    ringGroup = new THREE.Group();
    ringGroup.rotation.set(1.1, -0.12, 0.43, "ZXY");
    world.add(ringGroup);
    const mainRing = mesh(
      new THREE.TorusGeometry(1.32, 0.105, 32, 160),
      physical({
        color: 0xbec5c5,
        metalness: 1,
        roughness: 0.14,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.3,
      }),
      ringGroup,
    );
    mainRing.scale.z = 0.3;
    makeAnnulus(
      1.435,
      1.485,
      physical({
        color: 0xf6e9d8,
        metalness: 0.58,
        roughness: 0.13,
        clearcoat: 1,
        transmission: 0.18,
        thickness: 0.12,
        iridescence: 0.16,
      }),
    );
    makeAnnulus(
      1.535,
      1.565,
      physical({
        color: 0xabb8c1,
        metalness: 0.95,
        roughness: 0.19,
        clearcoat: 1,
      }),
    );
    mesh(
      new THREE.TorusGeometry(1.63, 0.009, 10, 160),
      physical({ color: 0xc6b69b, metalness: 0.85, roughness: 0.26 }),
      ringGroup,
    );
    moon = mesh(
      new THREE.SphereGeometry(0.145, 32, 24),
      physical({
        color: 0xf6f3e8,
        metalness: 0.2,
        roughness: 0.19,
        clearcoat: 1,
      }),
    );
    amber = mesh(
      new THREE.SphereGeometry(0.205, 40, 28),
      physical({
        color: 0xe8ae6e,
        metalness: 0.27,
        roughness: 0.13,
        transmission: 0.48,
        thickness: 0.4,
        ior: 1.45,
        clearcoat: 1,
        envMapIntensity: 1.0,
      }),
    );
    orbiter = mesh(
      new THREE.SphereGeometry(0.065, 24, 16),
      physical({ color: 0xd3dde2, metalness: 0.9, roughness: 0.16 }),
    );

    const points = [];
    let seed = 734;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 48; i++) {
      const x = (random() - 0.5) * 4.6,
        y = (random() - 0.5) * 4.5;
      if (x * x + y * y < 2.7) continue;
      points.push(x, y, -1.4 - random() * 1.3);
    }
    const starsGeo = remember(new THREE.BufferGeometry());
    starsGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    stars = new THREE.Points(
      starsGeo,
      remember(
        new THREE.PointsMaterial({
          color: 0x999489,
          size: 0.014,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      ),
    );
    world.add(stars);
    const shadow = mesh(
      new THREE.PlaneGeometry(3.5, 0.5),
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.65,
      }),
      scene,
    );
    shadow.position.set(0, -1.6, -1);
    host.dataset.renderer = "webgl";
    state.mode = "webgl";
    state.objects = world.children.length;
    state.logoTextures = 0;
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      onContextRestored,
    );
    updateTheme();
    resize();
    sync();
  }
  function pose() {
    const t = time;
    const blend =
      1 -
      Math.exp(-Math.max(0.016, Math.min(0.05, state.delta || 0.033)) / 0.16);
    view.x += (pointer.x - view.x) * blend;
    view.y += (pointer.y - view.y) * blend;
    world.rotation.y = 0.08 * Math.sin(t * 0.23) + view.x * 0.14;
    world.rotation.x = 0.025 * Math.sin(t * 0.19) + view.y * 0.1;
    world.position.y = 0.1 + Math.sin(t * 0.65) * 0.035;
    ringGroup.rotation.x = 1.1 + Math.sin(t * 0.24) * 0.065;
    ringGroup.rotation.z = 0.43 + Math.sin(t * 0.18) * 0.07;
    body.rotation.y = t * 0.065;
    moon.position.set(
      -1.65 + Math.sin(t * 0.32) * 0.055,
      0.99 + Math.cos(t * 0.42) * 0.06,
      -0.35,
    );
    amber.position.set(
      1.55 + Math.sin(t * 0.28) * 0.06,
      -0.94 + Math.cos(t * 0.36) * 0.08,
      0.5,
    );
    const angle = t * 0.32 + 0.8;
    orbiter.position.set(
      Math.cos(angle) * 1.92,
      Math.sin(angle) * 0.72,
      -Math.sin(angle) * 0.9,
    );
    stars.rotation.z = Math.sin(t * 0.08) * 0.015;
    state.pointer = { x: view.x, y: view.y };
  }
  function render() {
    if (
      disposed ||
      !renderer ||
      state.mode !== "webgl" ||
      host.clientWidth === 0
    )
      return;
    pose();
    renderer.render(scene, camera);
    frames++;
    Object.assign(state, { frames, time, paused: !running });
  }
  function tick(now) {
    if (!running || disposed) return;
    const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.1) : 0;
    lastTick = now;
    time += dt;
    state.delta = dt;
    // This deliberately slow sculpture has a 30 fps ceiling to limit background work.
    if (now - lastRender >= 31) {
      lastRender = now;
      render();
    }
    raf = requestAnimationFrame(tick);
  }
  function sync() {
    if (disposed || state.mode !== "webgl") return;
    const next =
      root.dataset.brandMotion === "playing" &&
      !document.hidden &&
      host.clientWidth > 0 &&
      !reduced.matches;
    if (next === running) {
      if (!next) render();
      return;
    }
    running = next;
    state.paused = !running;
    cancelAnimationFrame(raf);
    lastTick = 0;
    lastRender = 0;
    if (running) raf = requestAnimationFrame(tick);
    else render();
  }
  function resize() {
    if (!renderer || state.mode !== "webgl" || host.clientWidth === 0) return;
    const width = host.clientWidth,
      height = host.clientHeight,
      aspect = width / height;
    const viewHeight = Math.max(4.75, 4.3 / aspect);
    camera.left = (-viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
    sync();
  }
  function updateTheme() {
    if (!scene) return;
    const dark = root.classList.contains("dsu-dark");
    scene.environmentIntensity = dark ? 0.9 : 1;
    scene.userData.lights.key.intensity = dark ? 1.6 : 2;
    scene.userData.lights.fill.color.set(dark ? 0xa5c5ff : 0xc9dfff);
    scene.userData.lights.hemisphere.intensity = dark ? 0.3 : 0.6;
    stars.material.color.set(dark ? 0xc3cedd : 0x999489);
    stars.material.opacity = dark ? 0.7 : 0.5;
    body.material.color.set(dark ? 0xcad7ec : 0xf4f6ff);
    body.material.envMapIntensity = dark ? 1.2 : 1.05;
    state.theme = dark ? "dark" : "light";
    render();
  }
  function onPointer(event) {
    if (!finePointer.matches || reduced.matches || !running) return;
    const r = host.getBoundingClientRect();
    pointer.x = Math.max(
      -1,
      Math.min(1, ((event.clientX - r.left) / r.width) * 2 - 1),
    );
    pointer.y = Math.max(
      -1,
      Math.min(1, ((event.clientY - r.top) / r.height) * 2 - 1),
    );
  }
  function resetPointer() {
    pointer.x = 0;
    pointer.y = 0;
  }
  function fallback(reason) {
    cancelAnimationFrame(raf);
    running = false;
    state.mode = "fallback";
    state.paused = true;
    state.error = reason;
    host.dataset.renderer = "fallback";
    root.dataset.brandStatic = "true";
    root.dispatchEvent(new Event("brand-motion-capability"));
  }
  function onContextLost(event) {
    event.preventDefault();
    fallback("WebGL context lost");
  }
  function onContextRestored() {
    if (disposed) return;
    state.mode = "webgl";
    state.error = null;
    host.dataset.renderer = "webgl";
    delete root.dataset.brandStatic;
    root.dispatchEvent(new Event("brand-motion-capability"));
    render();
    sync();
  }
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.attributeName === "class"))
      updateTheme();
    sync();
  });
  const resizeObserver = new ResizeObserver(resize);
  function dispose() {
    window.removeEventListener("pagehide", dispose);
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    resizeObserver.disconnect();
    host.removeEventListener("pointermove", onPointer);
    host.removeEventListener("pointerleave", resetPointer);
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);
    for (const resource of resources) resource.dispose();
    envTarget?.dispose();
    renderer?.dispose();
    state.disposed = true;
  }
  try {
    setup();
  } catch (error) {
    fallback(String(error));
  }
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["data-brand-motion", "class"],
  });
  resizeObserver.observe(host);
  host.addEventListener("pointermove", onPointer);
  host.addEventListener("pointerleave", resetPointer);
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  addEventListener("pagehide", dispose, { once: true });

  return {
    getState: () => ({ ...state, pointer: { ...state.pointer } }),
    dispose,
  };
}
