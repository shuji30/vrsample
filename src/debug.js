import * as THREE from 'three';

const WIDTH = 640;
const HEIGHT = 560;
const REFRESH = 0.1; // 秒

/**
 * 左手コントローラーに貼りつく、VR 内で読めるデバッグパネル。
 * 入力プロファイル・軸・ボタンの生の値が見えるので、
 * 手元にないヘッドセット（Pimax など）でのコントローラー確認に使う。
 *
 * `?debug` を URL に付けると表示される。
 */
export function createDebugPanel(renderer, player) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22 * (HEIGHT / WIDTH)),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthTest: false }),
  );
  mesh.name = 'debugPanel';
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  mesh.position.set(0, 0.11, 0.02);
  mesh.rotation.x = -Math.PI / 3;
  mesh.visible = false;

  let attachedTo = null;
  let sinceRefresh = 0;
  let fps = 0;

  function line(text, y, color = '#d8e2ff', font = '20px ui-monospace, Menlo, Consolas, monospace') {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.fillText(text, 16, y);
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = 'rgba(6, 10, 22, 0.88)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = '#8ef0ff';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, WIDTH - 4, HEIGHT - 4);
    ctx.textBaseline = 'top';

    let y = 16;
    line('XR INPUT DEBUG', y, '#8ef0ff', 'bold 24px ui-monospace, Menlo, Consolas, monospace');
    y += 36;

    const session = renderer.xr.getSession();
    if (!session) {
      line('no active session', y, '#ffb4b4');
      texture.needsUpdate = true;
      return;
    }

    const sources = [...session.inputSources];
    line(`inputSources: ${sources.length}`, y);
    y += 30;

    for (const source of sources) {
      line(`[${source.handedness}] ${source.targetRayMode}`, y, '#ffd166');
      y += 26;
      line(`  ${source.profiles[0] ?? '(no profile)'}`, y, '#9fb3d9', '16px ui-monospace, Menlo, Consolas, monospace');
      y += 24;

      const gamepad = source.gamepad;
      if (!gamepad) {
        line('  gamepad: none', y, '#ffb4b4');
        y += 30;
        continue;
      }

      const axes = [...gamepad.axes].map((v, i) => `${i}:${v.toFixed(2)}`).join(' ');
      line(`  axes  ${axes || '(none)'}`, y, '#e8ecf8', '17px ui-monospace, Menlo, Consolas, monospace');
      y += 24;

      const pressed = gamepad.buttons
        .map((b, i) => (b.pressed ? `${i}` : b.value > 0.05 ? `${i}:${b.value.toFixed(1)}` : null))
        .filter(Boolean)
        .join(' ');
      line(`  btns  ${pressed || '-'}`, y, '#06d6a0', '17px ui-monospace, Menlo, Consolas, monospace');
      y += 32;
    }

    const p = player.player.position;
    line(
      `rig  x${p.x.toFixed(2)} y${p.y.toFixed(2)} z${p.z.toFixed(2)}  yaw ${THREE.MathUtils.radToDeg(player.player.rotation.y).toFixed(0)}deg`,
      HEIGHT - 60,
      '#9fb3d9',
      '17px ui-monospace, Menlo, Consolas, monospace',
    );
    const layer = session.renderState.baseLayer;
    const framebuffer = layer ? `${layer.framebufferWidth}x${layer.framebufferHeight}` : 'n/a';
    line(
      `views ${renderer.xr.getCamera().cameras.length}  fb ${framebuffer}  ${fps.toFixed(0)}fps`,
      HEIGHT - 34,
      '#9fb3d9',
      '17px ui-monospace, Menlo, Consolas, monospace',
    );

    texture.needsUpdate = true;
  }

  function update(dt) {
    if (dt > 0) fps = fps * 0.9 + (1 / dt) * 0.1; // ゆるく平滑化した実測フレームレート
    if (!mesh.visible) return;

    // 左手（なければ最初のコントローラー）にくっつける
    const target =
      player.controllers.find((c) => c.userData.handedness === 'left') ?? player.controllers[0];
    if (target && attachedTo !== target) {
      target.add(mesh);
      attachedTo = target;
    }

    sinceRefresh += dt;
    if (sinceRefresh < REFRESH) return;
    sinceRefresh = 0;
    draw();
  }

  return {
    mesh,
    update,
    get visible() {
      return mesh.visible;
    },
    setVisible(value) {
      mesh.visible = value;
      if (value) draw();
    },
    toggle() {
      this.setVisible(!mesh.visible);
    },
  };
}
