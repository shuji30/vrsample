# 5 人目（ワンピース 2）の白いピンヒールのパンプス（OP_Shoes）を作る（Blender の中で exec する。何度流してもよい）。服のあとに流す。
#   足の肌の形をなぞると肌の細かいでこぼこが革に写って波打ったので、足から独立したなめらかな形にする：
#   1) 足（かかと〜つま先）を NS 個の断面に分け、断面ごとの幅・まん中・足の裏の高さ・甲の高さを測り、よくならす
#   2) 断面ごとに、その外側を角の丸い四角（スーパー楕円）で包む。足の裏の下に靴底（厚さ SOLE）
#   3) つま先は足の先から TIP_L 前へ、細く低くすぼめてとがらせる（ポインテッドトウ）
#   4) 履き口：かかとは高さ HB、横へなだらかに下がり、甲の手前で V 字に切れ込む。PUMP_T より前は甲をおおう
#   5) ピンヒール：かかとのいちばん後ろの靴底から、前へ傾いて床へ下りる細い柱（後ろのふちはゆるく内へ反る）
#   革でおおう所の足の肌は隠す
import bpy, bmesh, math
import numpy as np
from mathutils import Vector
NS = 48; NA = 40                                         # 断面の数、断面のまわりの分割
OFF = 0.0032; SOLE = 0.004; TIP_L = 0.028; HB = 0.054; HS = 0.012;   # HB：かかとの後ろ（骨のふくらみを覆う高さ）。横へは HB_FALL の範囲で急に下がる
HB_FALL = 0.28; PUMP_T = 0.70; VDEPTH = 0.010   # PUMP_T：甲をおおい始める所（0.62 では甲のカバーが大きかった）
EXP = 3.0                                                # スーパー楕円の指数（大きいほど四角い）
ob = bpy.data.objects["Girl_Body"]; me = ob.data; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3)
vn = np.zeros(n*3); m.vertices.foreach_get("normal", vn); vn = vn.reshape(n, 3); ev.to_mesh_clear()
from mathutils.bvhtree import BVHTree as _BVH0
_real0 = [any(g.group in {ob.vertex_groups['body'].index, ob.vertex_groups['hidden_by_clothes'].index} and g.weight > 0.5 for g in v.groups) for v in me.vertices]
_footbvh = _BVH0.FromPolygons([Vector(c_) for c_ in co], [tuple(p_.vertices) for p_ in me.polygons if all(_real0[v_] and co[v_][2] < 0.25 for v_ in p_.vertices)])      # 肌の向き（隠す肌を光線で決めるのに使う）
for m_, s_ in zip(mods, st): m_.show_viewport = s_
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
bodyg = {body.index, hid.index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
def smooth(a, it):
    a = np.array(a, float)
    for _ in range(it): a[1:-1] = (a[:-2]+2*a[1:-1]+a[2:])/4
    return a
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
bm = bmesh.new(); solef = []; hide = set(); foot_info = []
for sg in (1, -1):
    F = real & (sg*co[:, 0] > 0.03) & (co[:, 2] < 0.20)
    idx = np.where(F)[0]; P = co[idx].copy(); P[:, 0] *= sg          # 左足も右足と同じ向き（x が正）で計算し、最後に sg を掛ける
    heel = P[:, 1].max(); toe = P[:, 1].min()
    # 足首より下（足の部分）だけ：かかと〜つま先の各断面で、足の裏から上 ZCAP まで
    ys = heel+(toe-heel)*np.linspace(0.0, 1.0, NS)
    cx = []; hw = []; zb = []; zt = []
    for y in ys:
        s = np.abs(P[:, 1]-y) < 0.006; Q = P[s]
        lo = Q[:, 2].min(); Q = Q[Q[:, 2] < lo+0.07]
        cx.append((Q[:, 0].min()+Q[:, 0].max())/2); hw.append((Q[:, 0].max()-Q[:, 0].min())/2); zb.append(lo); zt.append(Q[:, 2].max())
    cx = smooth(cx, 30); hw = smooth(hw, 30); zb = smooth(zb, 30); zt = smooth(zt, 30)
    hw[0] *= 0.8
    # つま先：足の T0 の所から先端（足の先から TIP_L 前）まで、高さと幅を 1 本のなめらかな曲線で細くする。
    #   足の先で急に変えると、段と切れ目ができて足袋のように見えた
    NT = 14; T0 = 0.70
    i0 = int(T0*(NS-1)); tip_y = toe-TIP_L
    ys2 = list(ys[:i0]); cx2 = list(cx[:i0]); hw2 = list(hw[:i0]); zb2 = list(zb[:i0]); zt2 = list(zt[:i0])
    y0, w0, h0, b0, c0 = ys[i0], hw[i0], zt[i0]-zb[i0], zb[i0], cx[i0]
    NTT = (NS-i0)+NT
    for j in range(NTT+1):
        u = j/NTT                                               # 0：T0、1：先端
        ys2.append(y0+(tip_y-y0)*u)
        cx2.append(c0+(cx[-1]-c0)*min(1.0, u*1.4))
        hw2.append(max(0.0010, w0*(1-u)**0.75))                    # 幅：指の付け根から先端へ、まっすぐ細くとがる（前から見て太かった）
        zb2.append(b0+(zb[-1]-b0)*min(1.0, u*1.3))
        yy = ys2[-1]
        if yy >= toe:                                            # 足のある所は、足の甲の形に沿わせる（甲の高さのまま延ばすと、指の上で浮いて甲と段ができた）
            zt2.append(float(np.interp(-yy, -ys, zt)))
        else:                                                    # 足の先から先端：丸くすぼめる
            ut = (toe-yy)/max(1e-6, toe-tip_y)
            zt2.append(zb2[-1]+0.003+(zt[-1]-zb2[-1]-0.003)*(1-ut**1.6)**0.7)
    tip_y = ys2[-1]
    # かかとを上から見て半円に：かかとの端から RR の範囲の断面の幅を、円に沿って細める（外へ足すと後ろへ張り出した）
    # かかとまわりを細く：かかとの端から HN の範囲の幅を、端へ向かって HK 倍まで細める（後ろから見てかかとが広かった）
    HN, HK = 0.06, 0.88
    for i_ in range(len(ys2)):
        d_ = heel-ys2[i_]
        if d_ < HN: hw2[i_] = (hw2[i_]+OFF)*(HK+(1-HK)*ss(d_/HN))-OFF
    RR = hw2[0]+OFF
    # かかとの端の底：足の裏はかかとの端で丸く上がるので、そのまま靴底にすると端が 7cm も上がり、後ろにひれが出た。
    #   RR より前の 2 つの断面の傾きを、端までまっすぐ延ばす（上のふち zt も同じだけ下げる）
    i1 = next(i_ for i_ in range(len(ys2)) if heel-ys2[i_] >= RR); i2 = min(i1+3, len(ys2)-1)
    sl = (zb2[i2]-zb2[i1])/(ys2[i2]-ys2[i1])
    for i_ in range(i1):
        nz = zb2[i1]+sl*(ys2[i_]-ys2[i1]); dz = zb2[i_]-nz
        if dz > 0: zb2[i_] = nz; zt2[i_] = zt2[i_]-dz
    for i_ in range(len(ys2)):
        d_ = heel-ys2[i_]
        if d_ < RR: hw2[i_] = (hw2[i_]+OFF)*math.sqrt(max(0.0, 1-((RR-d_)/RR)**2))-OFF        # 端（d=0）で幅 0：1 本の線に閉じる
    # 甲の V から先の上面：V の点からつま先の先へ、まっすぐなめらかに下りる線（参考：細いくさび形）。足の甲よりは下げない。
    #   足の指の形をなぞると、でこぼこに盛り上がって甲とのつながりが不自然だった
    TVv = PUMP_T-0.04
    iv = next(i_ for i_ in range(len(ys2)) if (heel-ys2[i_])/(heel-toe) >= TVv)
    zv = zt2[iv]; ztip = zb2[-1]+0.004; yv = ys2[iv]
    for i_ in range(iv, len(ys2)):
        u = (yv-ys2[i_])/max(1e-6, yv-ys2[-1])
        zl = ztip+(zv-ztip)*(1-u)**0.8
        if ys2[i_] >= toe: zl = max(zl, float(np.interp(-ys2[i_], -ys, zt))+0.0015)
        zt2[i_] = zl
    zt2 = list(smooth(zt2, 6))
    # かかとの後ろの下の角を丸める：端から RB2 の範囲で、靴底を端へ向かって丸く持ち上げる（横から見て角が突き出した）
    RB2 = 0.022
    for i_ in range(len(ys2)):
        d_ = heel-ys2[i_]
        if d_ < RB2: zb2[i_] += 0.016*(1-math.sqrt(max(0.0, 1-((RB2-d_)/RB2)**2)))
    # かかとの包みの後ろを内へ寄せる（張り出して見えた）：端から 3cm の範囲を、端ほど前へ（最大 CUP_IN）
    CUP_IN = globals().get("CUP_IN", 0.004)
    ys2 = [y_-CUP_IN*ss(1-(heel-y_)/0.03) if heel-y_ < 0.03 else y_ for y_ in ys2]
    N = len(ys2); tt = np.linspace(0, 1, N); opened = []
    rings = []
    for i in range(N):
        y = ys2[i]; c = cx2[i]; w = hw2[i]+OFF; b = zb2[i]-SOLE; top = zt2[i]+OFF
        H = top-b; t = (heel-y)/(heel-toe) if y >= toe else 1.0
        # 履き口の高さ（床の上ではなく、靴底からの高さ）。かかと HB → 横 HS → 甲の手前で V 字に下がり、PUMP_T より前は閉じる
        cut = HB+(HS-HB)*ss(t/HB_FALL)                              # 横の履き口の高さ
        cut = min(cut, H)
        # 横の壁の上のふち（cut_s）と、甲のまん中（cut_c）の高さ。横の壁は PUMP_T-0.14 から、まん中は PUMP_T から甲をおおう（上から見て U 字）
        # 履き口は 1 本のなめらかな線：かかとの上（HB）から横を斜めに下り、TV で甲の V の点（HV）になり、そこから先は甲をおおう。
        #   横の壁（cut_s）は V の点で H まで立ち上がり、甲のまん中（cut_c）は V の点の高さから前へなだらかに上がる
        TV = PUMP_T-0.04; HV = 0.016
        if t <= TV: cut_s = HB+(HV-HB)*(t/TV)                         # かかと→V：まっすぐ 1 本の線で下りる
        else: cut_s = HV+(H-HV)*ss((t-TV)/0.16)                       # V の先：横はなだらかにおおう（0.06 では段ができた）
        cut_s = min(cut_s, H)
        _d = heel-y; _r = 0.012                                       # かかとの後ろの上の角を、半径 1.2cm の丸みで落とす（横から見て角ばっていた）
        if _d < _r: cut_s -= _r*(1-math.sqrt(max(0.0, 1-((_r-_d)/_r)**2)))
        cut_c = cut_s if t <= TV else HV+(H-HV)*math.sin(min(1.0, (t-TV)/0.18)*math.pi/2)**1.4  # 甲のまん中：丸いアーチで上がる（V 字にしない）
        cut_c = min(cut_c, H)
        tap = 0.30*(1-ss((heel-y)/0.10))                           # かかと：下へ行くほど細くすぼめる（後ろから見て箱に見えた）
        tt_ = (heel-y)/(heel-toe)
        tap = max(tap, 0.62*ss((tt_-0.05)/0.12)*(1-ss((tt_-0.50)/0.18)))   # 土踏まずの下（シャンク）：靴底を細い線に（後ろから見て幅広のくさびに見えた）
        def pt(th):
            cx_ = math.cos(th); cz_ = math.sin(th)
            r = 1.0/((abs(cx_)**EXP+abs(cz_)**EXP)**(1.0/EXP))
            zz = cz_*r
            return c-w*cx_*r*(1-tap*(1-zz)), H*zz
        # 壁のふちの角度 thc：高さがちょうど cut_s になる所（二分探索）。点を、壁（0〜thc）とふちの間（thc〜π-thc）に分けて並べるので、
        #   ふちの点はいつもちょうど履き口の高さに来る（一律に切りそろえると、切れる点が断面ごとにずれて、ふちが波打った）
        lo_, hi_ = 0.0, math.pi/2
        if pt(hi_)[1] <= cut_s: thc = hi_
        else:
            for _ in range(30):
                mid = (lo_+hi_)/2
                if pt(mid)[1] < cut_s: lo_ = mid
                else: hi_ = mid
            thc = (lo_+hi_)/2
        ring = []
        for a in range(NA+1):
            s = a/NA
            if s <= 0.4: th = thc*s/0.4
            elif s >= 0.6: th = math.pi-thc*(1-s)/0.4
            else: th = thc+(math.pi-2*thc)*(s-0.4)/0.2
            x, z = pt(th)
            if 0.4 < s < 0.6:                                     # ふちの間（足の甲の上）：横のふちからまん中へ、cut_c までなめらかに下げる（U 字）
                zr = cut_s+(cut_c-cut_s)*math.sin(math.pi*(s-0.4)/0.2)**0.6   # 横から見て丸いアーチ
                z = min(z, zr)
            if 0.4 < s < 0.6 and t <= TV and heel-y > RR+0.004:   # 履き口が開いている所：ふちの間の面は足の甲の肌の内側へ沈めて隠す（中敷きのように）
                _q = Vector((sg*x, y, b+z)); _loc, _nor, _i, _d = _footbvh.find_nearest(_q)
                if _loc is not None: ring.append(bm.verts.new(_loc-_nor*0.004)); continue
            ring.append(bm.verts.new((sg*x, y, b+z)))
        rings.append(ring); opened.append(t <= TV and heel-y > RR+0.004)   # かかとの丸い所（後ろの壁）は面を残す（抜くとかかとに穴があいた）
    # 履き口が開いている断面どうしのあいだは、左右の壁の上を結ぶ面を作らない（作ると、履き口の高さに平らなひさしができ、横がめくれて見えた）
    A0, A1 = int(round(0.4*NA)), int(round(0.6*NA))
    for i in range(N-1):
        for a in range(NA):
            f = bm.faces.new((rings[i][a], rings[i][a+1], rings[i+1][a+1], rings[i+1][a]) if sg > 0 else (rings[i][a], rings[i+1][a], rings[i+1][a+1], rings[i][a+1]))
        # 靴底（平ら）
        f = bm.faces.new((rings[i][0], rings[i+1][0], rings[i+1][NA], rings[i][NA]) if sg > 0 else (rings[i][0], rings[i][NA], rings[i+1][NA], rings[i+1][0])); solef.append(f)
    # かかとの後ろをふさぐ（底の高さで平ら）
    tip = bm.verts.new((sg*cx2[-1], tip_y-0.0015, zb2[-1]-SOLE+0.0025))
    for a in range(NA):
        try: bm.faces.new((rings[-1][a], rings[-1][a+1], tip) if sg > 0 else (rings[-1][a+1], rings[-1][a], tip))
        except ValueError: pass
    try: bm.faces.new((rings[-1][NA], rings[-1][0], tip) if sg > 0 else (rings[-1][0], rings[-1][NA], tip))   # つま先の先の底（抜けて欠けていた）
    except ValueError: pass
    # かかとの後ろ：上から見て半円に回り込ませる。最初の断面の各点を、断面のまん中を中心に、
    #   x を cos、後ろへ y を sin で動かした断面を KB 個足し、最後は幅 0 の 1 本の線に閉じる（左右を板でつなぐと、四角く張り出した）
    KB = 0; R = 0.0                                          # 後ろに断面を足さない（足すと、まん中に縦のひれが残った）
    prev = rings[0]
    for kk in range(1, KB+1):
        phi = (math.pi/2)*kk/KB
        rb = []
        for a_ in range(NA+1):
            v0 = rings[0][a_].co
            x0 = sg*cx2[0]+(v0.x-sg*cx2[0])*math.cos(phi)
            rb.append(bm.verts.new((x0, ys2[0]+R*math.sin(phi), v0.z)))
        for a_ in range(NA):
            try: bm.faces.new((rb[a_], rb[a_+1], prev[a_+1], prev[a_]) if sg > 0 else (rb[a_], prev[a_], prev[a_+1], rb[a_+1]))
            except ValueError: pass
        try:
            f = bm.faces.new((prev[0], prev[NA], rb[NA], rb[0]) if sg > 0 else (prev[0], rb[0], rb[NA], prev[NA])); solef.append(f)
        except ValueError: pass
        prev = rb
    # ピンヒール（参考の図）：付け根はかかとの後ろ（HB_BACK）から土踏まずの手前（HB_FRONT）まで広く太く付け、
    #   後ろのふちはかかとの線からそのまま下へ、前のふちは土踏まずから曲線を描いて下り、少しずつ細くなって床の先（直径 HBD）になる。
    #   細い棒を挿しただけでは不自然（図の ×）。付け根の上の面は靴底の傾きに沿わせる
    HB_BACK = globals().get("HB_BACK", 0.008);   # 付け根をかかとの包みの内側に（後ろへはみ出して段になった）
    HB_FRONT = globals().get("HB_FRONT", 0.030); HBD = globals().get("HBD", 0.0065);   # ミドルヒール：付け根 3cm、床の先 1cm（ピンヒールは 0.022・0.0022）
    TIPF = 0.010
    ysn = [-v for v in ys2]; zsole = [z_-SOLE for z_ in zb2]
    def zs(y): return float(np.interp(-y, ysn, zsole))
    yb0 = heel-HB_BACK; yf0 = heel-HB_FRONT
    ybt = yb0-0.006; yft = ybt-HBD                                   # 床の先：後ろのふちは少し前へ傾いて下りる
    hw_top = (hw2[int(np.argmin([abs(v-(yb0+yf0)/2) for v in ys2]))]+OFF)*globals().get("HW_K", 0.50)          # 後ろから見た横幅（ピンヒールは 0.45）
    NSEG, NRH = 20, 24; hr = []
    for j in range(NRH+1):
        u = j/NRH
        yb = ybt+(yb0-ybt)*(1-u)**1.5                                # 後ろのふち：かかとの線から、ゆるく反って下りる
        yf = yft+(yf0-yft)*(1-u)**2.4                                # 前のふち：ほぼまっすぐ、少しだけ反って下りる（2.6 では曲がりすぎて爪のようだった）
        cy = (yb+yf)/2; ry = (yb-yf)/2
        rx = HBD/2+(hw_top-HBD/2)*(1-u)**2.6                         # 横幅：少しずつ細く
        ring = []
        for q in range(NSEG):
            a_ = 2*math.pi*q/NSEG; y = cy+ry*math.sin(a_); x = sg*cx2[0]+rx*math.cos(a_)
            z = (1-u)*zs(y) if j < NRH else 0.0
            if j == 0: z = zs(y)+0.002
            ring.append(bm.verts.new((x, y, z)))
        hr.append(ring)
    for j in range(NRH):
        for q in range(NSEG):
            q2 = (q+1) % NSEG; f = bm.faces.new((hr[j][q], hr[j][q2], hr[j+1][q2], hr[j+1][q]) if sg > 0 else (hr[j][q], hr[j+1][q], hr[j+1][q2], hr[j][q2])); solef.append(f)
    f = bm.faces.new(hr[-1][::-1] if sg > 0 else hr[-1]); solef.append(f)
    foot_info.append((sg, idx, ys.copy(), cx.copy(), zb.copy(), zt.copy()))   # 隠す肌は、靴ができてから、実際の履き口のふちの高さで決める（下）
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
# 履き口のふちを肌に沿わせる：ふちが肌から 3mm 浮いていて、内側がのぞいてめくれて見えた。ふちと、その 2 輪内側までを肌の 1mm 外へ寄せる
from mathutils.bvhtree import BVHTree as _BVH
_fp = [tuple(p_.vertices) for p_ in me.polygons if all(real[v_] for v_ in p_.vertices) and all(co[v_][2] < 0.25 for v_ in p_.vertices)]
_fb = _BVH.FromPolygons([Vector(c_) for c_ in co], _fp)
_rim = set(v for v in bm.verts if v.is_boundary and v.co.z > 0.03)
_ring1 = set(o_ for v in _rim for e_ in v.link_edges for o_ in [e_.other_vert(v)] if o_ not in _rim)
_ring2 = set(o_ for v in _ring1 for e_ in v.link_edges for o_ in [e_.other_vert(v)] if o_ not in _rim and o_ not in _ring1)
# 履き口のふちをならす：ふちの点が断面ごとに少しずつずれて、横から見てガタガタだった。ふちの線にそって、となりの 2 点の平均へ寄せる（40 回）
for _ in range(40):
    _new = {}
    for v in _rim:
        nb = [e_.other_vert(v) for e_ in v.link_edges if e_.is_boundary]
        if len(nb) == 2: _new[v] = v.co*0.5+(nb[0].co+nb[1].co)*0.25
    for v, c_ in _new.items(): v.co = c_
    for v in _ring1:                                  # 1 輪内側もいっしょに少し動かして、ふちだけ折れないように
        nb = [e_.other_vert(v) for e_ in v.link_edges]
        v.co = v.co*0.7+sum((n_.co for n_ in nb), Vector())*(0.3/len(nb))
# 隠す肌：肌の頂点ごとに、外向き・内向きに光線を飛ばし、靴に当たれば隠す。
#   外向きで当たる＝靴に包まれている。内向きで当たる＝肌が革を突きぬけている（隠すと下の靴が見える）。どちらでもなければ見せる。
#   決まった式（履き口の線の高さ）で決めると、ふちとずれて、穴があいたり肌が突きぬけたりした
from mathutils.bvhtree import BVHTree as _BVH2
_sb = _BVH2.FromBMesh(bm)
for sg, idx, ys_, cx_, zb_, zt_ in foot_info:
    for i in idx:
        p_ = Vector(co[i]); n_ = Vector(vn[i])
        if n_.length < 1e-6: continue
        n_.normalize()
        heel_, toe_ = ys_[0], ys_[-1]; tq = (heel_-p_.y)/(heel_-toe_)
        zb0 = float(np.interp(-p_.y, -ys_, zb_)); zt0 = float(np.interp(-p_.y, -ys_, zt_))
        Hl = zt0+OFF-(zb0-SOLE)
        cl = HB+(HV-HB)*(tq/TV) if tq <= TV else HV+(Hl-HV)*ss((tq-TV)/0.16)
        under = p_.z < zb0-SOLE+min(cl, Hl)-0.004                     # 履き口の線より下（式）
        h1 = _sb.ray_cast(p_+n_*0.0002, n_, 0.025)                    # 外に靴がある＝包まれている
        h2 = _sb.ray_cast(p_-n_*0.0002, -n_, 0.008)                   # 内に靴がある＝肌が革を突きぬけている
        # 式で下でも、外に靴が無ければ見せる（穴を作らない）。式で上でも、革を突きぬけていれば隠す
        if p_.z < zb0+0.006 or (under and h1[0] is not None) or h2[0] is not None: hide.add(int(i))
for _set, _k in ():                                  # （肌へ寄せると内側に折れ返しができたので使わない）
    for v in _set:
        loc, nor, _i, d = _fb.find_nearest(v.co)
        if loc is not None: v.co = v.co.lerp(loc+nor*0.001, _k)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
_sf = set(f for f in solef if f.is_valid)
for f in bm.faces: f.material_index = 1 if f in _sf else 0
def mat(name, col, rough, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(x for x in mt.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    for k_, v in kw.items(): b.inputs[k_].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt
old = bpy.data.objects.get("OP_Shoes")
if old: bpy.data.objects.remove(old, do_unlink=True)
mesh = bpy.data.meshes.new("OP_Shoes"); bm.normal_update(); bm.to_mesh(mesh); bm.free()
for p in mesh.polygons: p.use_smooth = True
shoes = bpy.data.objects.new("OP_Shoes", mesh); bpy.context.scene.collection.objects.link(shoes)
# エナメル：白い地にクリアコートを強く（つやつやの映り込み）。紙のようなマットに見えた
mesh.materials.append(mat("OP_PumpWhite", (0.95, 0.94, 0.93), 0.30, **{"Coat Weight": 1.0, "Coat Roughness": 0.03, "Coat IOR": 1.6, "Specular IOR Level": 0.6}))
mesh.materials.append(mat("OP_PumpSole", (0.93, 0.92, 0.91), 0.25, **{"Coat Weight": 0.9, "Coat Roughness": 0.05}))     # 靴底とヒールも白（ベージュだと後ろから箱に見えた）
ls = shoes.modifiers.new("Smooth", 'LAPLACIANSMOOTH'); ls.iterations = 12; ls.lambda_factor = 0.6; ls.lambda_border = 0.0; ls.use_volume_preserve = True   # 面の皺（断面ごとの点のずれ）をならす。ふちは動かさない
sd = shoes.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.0028; sd.offset = 1.0; sd.use_rim = True   # 厚み 2.8mm（1.2mm では紙のふちに見えた）。use_even_offset は、幅 0 に閉じた頂点で外へ大きく飛び出したので使わない
sb = shoes.modifiers.new("Subdivision", 'SUBSURF'); sb.levels = 2; sb.render_levels = 2      # 面をなめらかに（カクカクしていた）
hl = list(hide); body.remove(hl); hid.add(hl, 1.0, 'REPLACE')
rig.data.pose_position = was
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
print("pump built:", len(mesh.vertices), "verts, hidden foot verts", len(hl))
