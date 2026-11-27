// 女の子の VRM が、ゲームの仕様（docs/girl-blender.md の 4）を満たすかを調べる。Blender で書き出したあとに実行する。
//
//   node scripts/vrm-audit.mjs models/girl-knit.vrm   # 1 つ
//   node scripts/vrm-audit.mjs models/*.vrm           # 全部
//
// 調べること：VRM の版・利用条件（売り物に使えるか）・人型の骨・表情・視線・揺れ物（髪とスカート。スカートの骨の名前）・
// 軽さ（三角形・素材・ファイルの大きさ）。足りない所は「✗」で出す。依存なし（GLB の JSON を読むだけ）
import fs from 'node:fs';
const REQ_BONES = ['hips','spine','chest','neck','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot'];
const REQ_EXP = ['happy','relaxed','surprised','blink','blinkRight','aa','ih','ou','ee','oh'];
for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const len = buf.readUInt32LE(12); const json = JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
  const ext = json.extensions ?? {};
  const vrm1 = ext.VRMC_vrm; const vrm0 = ext.VRM;
  const out = { file: f.split('/').pop(), MB: +(buf.length / 1e6).toFixed(1), version: vrm1 ? '1.0' : vrm0 ? '0.x' : 'none' };
  let tris = 0;
  for (const m of json.meshes ?? []) for (const p of m.primitives) { const acc = p.indices != null ? json.accessors[p.indices] : json.accessors[p.attributes.POSITION]; tris += (p.indices != null ? acc.count : acc.count) / 3; }
  out.tris = Math.round(tris); out.materials = (json.materials ?? []).length; out.images = (json.images ?? []).length;
  if (vrm1) {
    const m = vrm1.meta ?? {};
    out.meta = { name: m.name, authors: m.authors, commercial: m.commercialUsage, avatarPermission: m.avatarPermission, modification: m.modification, redistribution: m.allowRedistribution, license: m.licenseUrl };
    const hb = vrm1.humanoid?.humanBones ?? {};
    out.missingBones = REQ_BONES.filter((b) => !hb[b]);
    out.toes = Boolean(hb.leftToes); out.fingers = Object.keys(hb).filter((k) => /Proximal|Intermediate|Distal/.test(k)).length;
    const ex = { ...(vrm1.expressions?.preset ?? {}), ...(vrm1.expressions?.custom ?? {}) };
    out.missingExp = REQ_EXP.filter((e) => !ex[e]);
    out.lookAt = vrm1.lookAt?.type ?? null;
    const sb = ext.VRMC_springBone;
    const nodes = json.nodes ?? [];
    const jointNames = (sb?.springs ?? []).flatMap((s) => s.joints.map((j) => nodes[j.node]?.name ?? ''));
    out.springs = (sb?.springs ?? []).length; out.colliders = (sb?.colliders ?? []).length;
    out.skirtJoints = jointNames.filter((n) => /skirt/i.test(n)).length;
    out.skirtFront = jointNames.some((n) => /skirt/i.test(n) && /front/i.test(n)); out.skirtSide = jointNames.some((n) => /skirt/i.test(n) && /side/i.test(n));
  } else if (vrm0) {
    const m = vrm0.meta ?? {};
    out.meta = { title: m.title, author: m.author, commercial: m.commercialUssageName, allowed: m.allowedUserName, license: m.licenseName };
  }
  const ng = [];
  if (out.version !== '1.0') ng.push('VRM 1.0 で書き出す');
  if (out.meta && out.meta.commercial === 'personalNonProfit') ng.push('利用条件：商用利用を許可する（いまは個人・非営利のみ）');
  if (out.missingBones?.length) ng.push(`人型の骨が足りない：${out.missingBones.join(' ')}`);
  if (out.missingExp?.length) ng.push(`表情が足りない：${out.missingExp.join(' ')}`);
  if (out.lookAt == null && out.version === '1.0') ng.push('視線（lookAt）を設定する');
  if ((out.springs ?? 0) < 3) ng.push(`揺れ物が少ない（${out.springs ?? 0} 本）：髪とスカートに spring bone を設定する`);
  if (!out.skirtJoints && out.version === '1.0') ng.push('スカートの揺れ物が無い：骨の名前に skirt を入れ、根もとの前を front・横を side に');
  if ((out.colliders ?? 0) === 0 && out.version === '1.0') ng.push('コライダーが無い：髪が肩と胸に入らないよう置く');
  if (out.tris > 50000) ng.push(`三角形が多い（${out.tris}）：3〜5 万まで`);
  if (out.materials > 5) ng.push(`素材が多い（${out.materials}）：3〜5 個にまとめる`);
  if (out.MB > 15) ng.push(`ファイルが大きい（${out.MB}MB）：15MB まで`);
  console.log(`\n${out.file}（${out.MB}MB・三角形 ${out.tris}・素材 ${out.materials}・揺れ物 ${out.springs ?? '-'}・利用条件 ${out.meta?.commercial ?? '-'}）`);
  if (ng.length === 0) console.log('  ○ 仕様を満たしています');
  for (const n of ng) console.log(`  ✗ ${n}`);
  if (process.env.JSON) console.log(JSON.stringify(out));
}
