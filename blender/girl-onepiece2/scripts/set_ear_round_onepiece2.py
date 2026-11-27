# 5 人目（ワンピース 2）の耳を、頭にきれいに沿う丸い耳にする（Blender の中で exec する）。シェイプキー custom-ear-round を作り直す（何度流してもよい）。
#   耳の大きさと寝かせ方は MakeHuman のキー（l/r-ear-scale-decr 0.6・l/r-ear-wing-decr 0.6）で決め、ここではその上に
#   1) 耳たぶは頭へ寄せて顔にくっつけ、耳の上側は頭から少し離す
#   2) 横から見た上と後ろのふちを、耳のまん中を中心にした楕円へ少し寄せる（上のとがりを丸める。内へ寄せるだけ）
#   写真の耳（上は目の上のまぶたの高さ、耳たぶは鼻の下の高さ。頭に沿い、上のふちだけ少し離れ、耳たぶは顔に付く）に合わせた値
#   耳は頂点グループ ears だけを動かす（まわりへ広げて動かすと、耳が引き伸ばされて、とがった妖怪のような耳になった）
import bpy, math
import numpy as np
FLAT = globals().get("FLAT", 0.6); SHRINK_Z = globals().get("SHRINK_Z", 0.95)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
for s in ("l-", "r-"):
    kb[s+"ear-scale-decr"].value = globals().get("EAR_SCALE_DECR", 0.15); kb[s+"ear-wing-decr"].value = globals().get("EAR_WING_DECR", 1.0)
kb["custom-ear-tilt"].value = globals().get("EAR_TILT", 0.6)            # 耳の後ろへの傾き（4 人目は 1.0。傾きすぎていた）
k0 = kb.get("custom-ear-round")
if k0: k0.value = 0.0
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
B = co_of(kb["Basis"]); mix = B.copy()
for k in kb:
    if k.name in ("Basis", "custom-ear-round") or k.name.startswith("exp-") or k.mute or k.value == 0: continue
    mix += (co_of(k)-B)*k.value
ei = ob.vertex_groups["ears"].index
ew = np.array([max([g.weight for g in v.groups if g.group == ei] or [0.0]) for v in me.vertices])
# 見えている耳の外のふちの一部は ears グループに入っていない。グループから GROW_RINGS 輪広げた範囲のうち、
# 付け根より横へ突き出している所も耳として扱う（突き出しが 0 → 6mm で重み 0 → 1。付け根の肌は動かさない）
_adj = [[] for _ in range(n)]
for _e in me.edges: _a, _b = _e.vertices; _adj[_a].append(_b); _adj[_b].append(_a)
_g = ew > 0.5
for _ in range(globals().get("GROW_RINGS", 2)):
    _n2 = _g.copy()
    for _i in np.where(_g)[0]: _n2[_adj[_i]] = True
    _g = _n2
for _sg in (1, -1):
    _c = (ew > 0.5) & (_sg*mix[:, 0] > 0)
    if not _c.any(): continue
    _x0 = np.percentile(_sg*mix[_c, 0], 5)
    _s = _g & (_sg*mix[:, 0] > 0) & (ew <= 0.5)
    ew[_s] = np.clip((_sg*mix[_s, 0]-_x0)/0.006, 0, 1)
D = np.zeros((n, 3)); NB = 48
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
for sg in (1, -1):
    idx = np.where((ew > 0.01) & (sg*mix[:, 0] > 0))[0]
    if len(idx) == 0: continue
    P = mix[idx]; w0 = ew[idx]; core = w0 > 0.5
    ax = sg*P[:, 0]; x0 = np.percentile(ax[core], 5)
    cz0 = (P[core, 2].min()+P[core, 2].max())/2; hz = (P[core, 2].max()-P[core, 2].min())/2
    low = np.clip((cz0-P[:, 2])/hz, 0, 1)                    # 耳たぶ（下半分）
    high = np.clip((P[:, 2]-cz0)/hz, 0, 1)                   # 耳の上半分
    # 本物の耳は、耳たぶが顔にくっつき、上側が頭から少し離れる。高さで寄せ方を変える：
    #   耳たぶは張り出しの LOBE_FLAT を頭へ寄せ、上側は寄せずに TOP_OUT 外へ出す（全体を同じだけ寄せたら、上が頭に貼りつき、耳たぶが浮いた）
    D[idx, 0] = -sg*np.maximum(ax-x0, 0)*globals().get("LOBE_FLAT", 0.7)*low*w0
    D[idx, 0] += sg*globals().get("TOP_OUT", 0.003)*high*w0
    # 耳たぶ：顔の下半分を細くしてあるので、耳たぶの下の肌は内側にあり、正面から見て耳たぶが顔から離れて浮いていた。
    #   耳たぶを LOBE_IN 内へ、LOBE_UP 上へ寄せる
    D[idx, 0] -= sg*globals().get("LOBE_IN", 0.003)*low**1.5*w0
    D[idx, 2] += globals().get("LOBE_UP", 0.0)*low*w0
    # 耳の面を顔のほうへ向ける：前のふち（顔側の付け根。-y のいちばん前、x は付け根 x0）を通る縦の軸のまわりに、
    #   上から見て EAR_TURN 度まわす（後ろのふちが外へ出て、耳の穴のある面が前を向く）。耳たぶは顔に付けたままにするので、下ほど弱める
    yf = P[core, 1].min(); yb = P[core, 1].max()
    D[idx, 0] += sg*globals().get("EAR_OPEN", 0.0)*np.clip((P[:, 1]-yf)/(yb-yf), 0, 1)*(1-0.8*low)*w0
    a_ = math.radians(globals().get("EAR_TURN", 0.0))*(1-0.8*low)*w0
    rx = ax-x0; ry = P[:, 1]-yf                                # 付け根の軸からの位置（x は外向き）
    nrx = rx*np.cos(a_)+ry*np.sin(a_); nry = -rx*np.sin(a_)+ry*np.cos(a_)
    D[idx, 0] += sg*(nrx-rx); D[idx, 1] += nry-ry
    cy = (P[core, 1].min()+P[core, 1].max())/2; cz = (P[core, 2].min()+P[core, 2].max())/2
    ay = (P[core, 1].max()-P[core, 1].min())/2*globals().get("WIDEN", 1.08); az = (P[core, 2].max()-P[core, 2].min())/2*SHRINK_Z
    dy = P[:, 1]-cy; dz = P[:, 2]-cz; r = np.hypot(dy, dz); th = np.arctan2(dz, dy)
    b = ((th+math.pi)/(2*math.pi)*NB).astype(int) % NB
    R = np.array([r[(b == i) & core].max() if ((b == i) & core).any() else np.nan for i in range(NB)])
    R = np.where(np.isnan(R), np.nanmean(R), R); R = (np.roll(R, 1)+2*R+np.roll(R, -1))/4
    thc = -math.pi+(np.arange(NB)+0.5)*2*math.pi/NB
    E = 1/np.sqrt((np.cos(thc)/ay)**2+(np.sin(thc)/az)**2)
    Rv = np.interp(th, thc, R, period=2*math.pi); Ev = np.interp(th, thc, E, period=2*math.pi)
    w = np.clip(r/Rv, 0, 1)**2.5*ss((np.cos(th)+0.35)/0.6)*w0
    # 内へ寄せるだけでは、とがりを削るだけで丸みが出なかった。外へも GROW 倍までふくらませて、上の丸い C の字と、ふっくらした耳たぶにする
    rn = r*(1+(np.clip(Ev/Rv, 0.0, globals().get("GROW", 1.12))-1)*w)
    D[idx, 1] = cy+np.cos(th)*rn-P[:, 1]; D[idx, 2] = cz+np.sin(th)*rn-P[:, 2]
    print("ear", sg, "root x", round(float(x0), 4), "max move mm", round(float(np.abs(D[idx]).max())*1000, 1))
k = k0 or ob.shape_key_add(name="custom-ear-round", from_mix=False)
k.data.foreach_set("co", (B+D).ravel()); k.value = 1.0; me.update()
