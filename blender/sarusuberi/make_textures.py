# さるすべりのテクスチャを描く（Blender の中で exec する）。numpy で描いて、textures/ に保存する。何度実行してもよい。
#   saru_leaf.png   … 葉の付いた小枝（4 種。2×2 に並べる）。アルファ付き。葉は楕円で、中央の筋と横の筋・色むらあり
#   saru_flower.png … 花穂（2 種。縦長を 2 つ横に並べる）。アルファ付き。ちぢれた 6 枚の花びら・黄色いしべ・つぼみ
#   saru_bark.jpg   … 樹皮（上下左右につながる）。つるつるで、薄茶・クリーム・灰桃・灰緑のまだら。はがれた所のふちは少し濃い
#   saru_bark_n.png … 樹皮の凹凸（ノーマルマップ。弱め）
# 画像の配列は [y][x]（y = 0 が下）。色は sRGB の値で描く。
import bpy, math, os
import numpy as np

TEXDIR = globals().get("TEXDIR", "C:/Users/shuji/vrsample/blender/sarusuberi/textures/")
os.makedirs(TEXDIR, exist_ok=True)
rng = np.random.default_rng(globals().get("TEXSEED", 5))
def U(a, b): return float(rng.uniform(a, b))

def ss(a, b, x): t = np.clip((x-a)/(b-a), 0, 1); return t*t*(3-2*t)
def region(bounds, cx, cy, r):
    """bounds = (x0, y0, x1, y1) の中で、(cx, cy) から半径 r の四角。ピクセルの中心の座標も返す"""
    x0 = max(bounds[0], int(cx-r)); x1 = min(bounds[2], int(cx+r)+2); y0 = max(bounds[1], int(cy-r)); y1 = min(bounds[3], int(cy+r)+2)
    if x1 <= x0 or y1 <= y0: return None
    X, Y = np.meshgrid(np.arange(x0, x1)+0.5, np.arange(y0, y1)+0.5)
    return x0, y0, X, Y
def over(img, x0, y0, rgb, a):
    """img に rgb を a の濃さで重ねる（上に描いた物が手前）"""
    h, w = a.shape; sub = img[y0:y0+h, x0:x0+w]
    sub[..., :3] = sub[..., :3]*(1-a[..., None])+np.clip(rgb, 0, 1)*a[..., None]
    sub[..., 3] = sub[..., 3]+a*(1-sub[..., 3])
def disc(img, bounds, cx, cy, r, col):
    b = region(bounds, cx, cy, r+1)
    if b is None: return
    x0, y0, X, Y = b; a = np.clip(r-np.hypot(X-cx, Y-cy)+0.5, 0, 1)
    over(img, x0, y0, np.broadcast_to(np.array(col), a.shape+(3,)), a)
def stroke(img, bounds, pts, r0, r1, col):
    """太さが r0 → r1 に変わる線（丸を並べて描く）"""
    pts = np.asarray(pts, float); seg = np.hypot(*np.diff(pts, axis=0).T); n = max(2, int(seg.sum()/max(0.6, min(r0, r1)*0.5)))
    t = np.linspace(0, 1, n); cum = np.concatenate([[0], np.cumsum(seg)])/max(seg.sum(), 1e-6)
    xs = np.interp(t, cum, pts[:, 0]); ys = np.interp(t, cum, pts[:, 1])
    for x, y, tt in zip(xs, ys, t): disc(img, bounds, x, y, r0+(r1-r0)*tt, np.array(col)*(0.9+0.2*tt))
def bezier(p0, p1, p2, n=24):
    t = np.linspace(0, 1, n)[:, None]; return (1-t)**2*np.array(p0)+2*(1-t)*t*np.array(p1)+t*t*np.array(p2)
def fill_fringe(img):
    """透明な所の色を、見えている所の平均にする（遠くで縮めたとき、ふちが黒くにじまないように）"""
    a = img[..., 3]; m = a > 0.5
    if m.any(): img[~m, :3] = img[m, :3].mean(axis=0)
def save(arr, name, fmt, noncolor=False):
    Hh, Ww = arr.shape[:2]; old = bpy.data.images.get(name)
    if old: bpy.data.images.remove(old)
    alpha = arr.shape[2] == 4
    im = bpy.data.images.new(name, Ww, Hh, alpha=alpha)
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    px = arr if alpha else np.concatenate([arr, np.ones((Hh, Ww, 1))], axis=2)
    im.pixels.foreach_set(np.clip(px, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = TEXDIR+name; im.file_format = fmt; im.save()
    im.filepath = TEXDIR+name; im.reload()
    return im

# ── 葉 ──
LEAF_COLS = [(0.27, 0.43, 0.16), (0.31, 0.49, 0.18), (0.23, 0.38, 0.14), (0.36, 0.53, 0.20), (0.42, 0.54, 0.19), (0.30, 0.46, 0.20)]
def leaf(img, bounds, bx, by, ang, L, wr):
    cx = bx+math.cos(ang)*L/2; cy = by+math.sin(ang)*L/2
    b = region(bounds, cx, cy, L/2+3)
    if b is None: return
    x0, y0, X, Y = b
    dx = X-bx; dy = Y-by; c, s_ = math.cos(ang), math.sin(ang)
    s = dx*c+dy*s_; t = -dx*s_+dy*c; u = s/L
    uc = np.clip(u, 0, 1)
    half = wr*L*0.5*np.sin(np.pi*uc)**0.75*(1.10-0.30*uc)                 # 楕円。先は少しとがる
    a = np.clip(half-np.abs(t)+0.5, 0, 1)*(u > 0)*(u < 1)
    if a.max() <= 0: return
    col = np.array(LEAF_COLS[rng.integers(len(LEAF_COLS))])*U(0.88, 1.10)
    if rng.random() < 0.06: col = np.array((0.52, 0.40, 0.20))            # ときどき、赤みのある若い葉
    e = np.abs(t)/np.maximum(half, 1e-3)
    shade = 1.0+0.09*np.sign(t)*U(-1, 1)-0.16*e**3-0.10*(1-uc)**4         # 中央の筋で折れているので、左右で明るさが違う。ふちと付け根は少し暗い
    mid = np.clip(1-np.abs(t)/1.2, 0, 1)*(uc < 0.93)
    lat = np.clip(1-np.abs(np.sin(np.pi*(s-np.abs(t)*1.4)/L*7))/0.16, 0, 1)*(e < 0.85)*(e > 0.08)
    grain = rng.normal(0, 0.025, a.shape)
    rgb = col*(shade+grain)[..., None]+(mid*0.17+lat*0.05)[..., None]*np.array((0.55, 0.62, 0.32))
    over(img, x0, y0, rgb, a)
def leaf_cell(img, ox, oy, C):
    bounds = (ox, oy, ox+C, oy+C)
    drift = U(-0.10, 0.10)*C
    tw = bezier((ox+C*0.5, oy+C*0.01), (ox+C*0.5+drift*0.3, oy+C*0.45), (ox+C*0.5+drift, oy+C*0.82))
    stroke(img, bounds, tw, C*0.012, C*0.005, (0.38, 0.30, 0.20))
    leaves = []
    n = int(rng.integers(4, 6))
    for k in range(n):
        tt = 0.14+0.70*k/(n-1)
        i = int(tt*(len(tw)-1)); p = tw[i]; d = tw[min(i+1, len(tw)-1)]-tw[max(i-1, 0)]; base_ang = math.atan2(d[1], d[0])
        L = C*(0.33-0.13*tt)*U(0.85, 1.08)
        for side, shift in ((1, 0.0), (-1, 0.035)):                      # 向かい合わせ（少しずらす）
            j = min(len(tw)-1, int((tt+shift)*(len(tw)-1))); q = tw[j]
            leaves.append((q[0], q[1], base_ang+side*U(0.70, 1.15), L*U(0.9, 1.05), U(0.40, 0.48)))
    p = tw[-1]
    for side in (1, -1): leaves.append((p[0], p[1], math.pi/2+side*U(0.20, 0.45), C*U(0.16, 0.21), 0.44))
    rng.shuffle(leaves)
    for bx, by, ang, L, wr in leaves: leaf(img, bounds, bx, by, ang, L, wr)
def make_leaf_atlas(S=1024):
    img = np.zeros((S, S, 4)); C = S//2
    for cy in (0, 1):
        for cx in (0, 1): leaf_cell(img, cx*C, cy*C, C)
    fill_fringe(img); return img

# ── 花穂 ──
PINKS = [(0.93, 0.33, 0.60), (0.96, 0.43, 0.68), (0.88, 0.26, 0.53), (0.97, 0.55, 0.76), (0.90, 0.36, 0.64)]
def floret(img, bounds, cx, cy, r):
    b = region(bounds, cx, cy, r*1.05+2)
    if b is None: return
    x0, y0, X, Y = b
    base = np.array(PINKS[rng.integers(len(PINKS))])*U(0.92, 1.06); a0 = U(0, 2*math.pi)
    for k in range(6):
        pa = a0+k*math.pi/3+U(-0.18, 0.18); pr = r*U(0.40, 0.50); pd = r*U(0.50, 0.58)
        px = cx+math.cos(pa)*pd; py = cy+math.sin(pa)*pd
        dx = X-px; dy = Y-py; d = np.hypot(dx, dy); th = np.arctan2(dy, dx); ph = U(0, 6.3)
        edge = pr*(1+0.17*np.sin(7*th+ph)+0.08*np.sin(13*th+2*ph))     # ちぢれたふち
        a = np.clip(edge-d+0.6, 0, 1)
        claw = np.clip(r*0.07-np.abs(-(X-cx)*math.sin(pa)+(Y-cy)*math.cos(pa))+0.5, 0, 1)*(((X-cx)*math.cos(pa)+(Y-cy)*math.sin(pa)) > 0)*(np.hypot(X-cx, Y-cy) < pd)
        a = np.maximum(a, claw*0.9)
        crinkle = 0.10*np.sin(7*th+ph+1.3)*np.clip(d/pr, 0, 1)+0.06*np.sin(d/pr*9+ph)
        shade = U(0.90, 1.08)+crinkle-0.12*np.clip(d/pr, 0, 1.2)**3+0.10*np.clip(1-d/pr, 0, 1)
        over(img, x0, y0, base*shade[..., None], a)
    disc(img, bounds, cx, cy, r*0.13, (0.66, 0.62, 0.28))                  # まん中
    for k in range(10):                                                     # 黄色いしべ
        sa = U(0, 2*math.pi); sd = r*U(0.08, 0.24)
        disc(img, bounds, cx+math.cos(sa)*sd, cy+math.sin(sa)*sd, max(1.2, r*0.045), (0.98, U(0.78, 0.88), 0.28))
def bud(img, bounds, cx, cy, r):
    b = region(bounds, cx, cy, r+2)
    if b is None: return
    x0, y0, X, Y = b; d = np.hypot(X-cx, Y-cy); a = np.clip(r-d+0.5, 0, 1)
    hl = np.clip(1-np.hypot(X-(cx-r*0.35), Y-(cy+r*0.35))/(r*0.9), 0, 1)
    col = np.array((0.78, 0.22, 0.44))*U(0.9, 1.08)
    rgb = col*(0.82+0.18*(1-d/r))[..., None]+hl[..., None]*np.array((0.25, 0.20, 0.22))
    over(img, x0, y0, rgb, a)
def panicle_cell(img, ox, W, Hh):
    bounds = (ox, 0, ox+W, Hh); cx = ox+W/2; drift = U(-0.06, 0.06)*W
    rach = bezier((cx, Hh*0.02), (cx+drift*0.4, Hh*0.5), (cx+drift, Hh*0.93))
    items = []
    for k in range(14):                                                     # 花穂の小枝
        h = U(0.06, 0.80); i = int(h*(len(rach)-1)); p = rach[i]; side = 1 if k % 2 else -1
        reach = W*0.42*(1-h)**0.6
        items.append(("twig", [p, p+np.array((side*reach*0.5, reach*0.35)), p+np.array((side*reach, reach*0.75))]))
    for k in range(int(rng.integers(64, 78))):
        h = float(rng.beta(1.5, 1.6))*0.90+0.04
        wh = W*0.46*(1-h)**0.55*min(1.0, h*3.5+0.35)
        x = cx+drift*h+U(-1, 1)*wh*0.88; y = Hh*(0.05+h*0.88)+U(-12, 12)
        if (h > 0.72 and rng.random() < 0.65) or rng.random() < 0.10:
            items.append(("bud", x, y, U(9, 15)*(1.1-0.4*h)))
        else:
            items.append(("floret", x, y, U(40, 60)*(1-0.40*h)))
    stroke(img, bounds, rach, 5.0, 2.0, (0.40, 0.38, 0.22))
    twigs = [it for it in items if it[0] == "twig"]; others = [it for it in items if it[0] != "twig"]
    for it in twigs: stroke(img, bounds, bezier(*it[1], n=12), 2.6, 1.3, (0.42, 0.40, 0.22))
    rng.shuffle(others)
    others.sort(key=lambda it: 0 if it[0] == "bud" else 1)                 # つぼみは奥、花は手前
    for it in others:
        if it[0] == "bud": bud(img, bounds, it[1], it[2], it[3])
        else: floret(img, bounds, it[1], it[2], it[3])
def make_flower_atlas(S=1024):
    img = np.zeros((S, S, 4))
    for c in (0, 1): panicle_cell(img, c*(S//2), S//2, S)
    fill_fringe(img); return img

# ── 樹皮 ──
def pnoise(S, fx, fy):
    """上下左右につながるノイズ（白色雑音を、周波数で丸める）。fx・fy … どれくらい細かいか（小さいほど大きな模様）"""
    w = rng.normal(size=(S, S)); F = np.fft.fft2(w)
    ky = np.fft.fftfreq(S)[:, None]; kx = np.fft.fftfreq(S)[None, :]
    n = np.real(np.fft.ifft2(F*np.exp(-((kx/fx)**2+(ky/fy)**2)))); return (n-n.mean())/n.std()
def make_bark(S=1024):
    n1 = pnoise(S, 0.012, 0.0045)                                           # 大きな斑（幹に沿って縦長）
    n2 = pnoise(S, 0.020, 0.008); n3 = pnoise(S, 0.035, 0.014)
    fine = pnoise(S, 0.30, 0.12); streak = pnoise(S, 0.20, 0.015)
    TAN = np.array((0.76, 0.62, 0.50)); CREAM = np.array((0.88, 0.82, 0.72)); PINKG = np.array((0.70, 0.57, 0.52))
    OLIVE = np.array((0.64, 0.61, 0.52)); ORANGE = np.array((0.80, 0.60, 0.45))
    col = np.broadcast_to(TAN, (S, S, 3)).copy()
    layers = []
    # 実物の斑は、色の差が小さく、ふちもぼんやりしている（くっきり塗ると迷彩柄に見えた）
    for n, start, full, c, k in ((n2, -1.2, -1.9, ORANGE, 0.45), (n1, 0.35, 1.05, CREAM, 0.75), (n1, -0.55, -1.25, PINKG, 0.55), (n3, 1.1, 1.7, OLIVE, 0.35)):
        m = ss(start, full, n)*k                                            # start で 0、full で k（負の向きでもよい）
        layers.append(m); col = col*(1-m[..., None])+c*m[..., None]
    height = np.zeros((S, S))
    for m in layers:
        rim = np.clip(m*(1-m)*4, 0, 1)                                       # 斑のふち（はがれた所）はほんの少し濃く、少し高い
        col = col*(1-0.06*rim[..., None]); height += 0.5*rim-0.2*m
    col = col*(1+0.05*fine[..., None]+0.025*streak[..., None])
    height += 0.12*fine+0.08*streak
    gy = (np.roll(height, -1, 0)-np.roll(height, 1, 0))*0.5; gx = (np.roll(height, -1, 1)-np.roll(height, 1, 1))*0.5
    k = 2.2; nrm = np.stack([-gx*k, -gy*k, np.ones_like(gx)], axis=-1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    return np.clip(col, 0, 1), nrm*0.5+0.5

leaf_img = save(make_leaf_atlas(), "saru_leaf.png", 'PNG')
flower_img = save(make_flower_atlas(), "saru_flower.png", 'PNG')
bc, bn = make_bark()
bark_img = save(bc, "saru_bark.jpg", 'JPEG')
bark_n_img = save(bn, "saru_bark_n.png", 'PNG', noncolor=True)
print("textures saved:", TEXDIR)
