/**
 * 時間帯のプリセット。
 *
 * 室内シーンでは「時間帯」がそのまま照明シナリオになる。太陽の高さと色、
 * 窓から入る空の光、室内灯の点き具合、そして露出。この 4 つを揃えて動かすと、
 * 同じ部屋でもまったく違う空気になる。
 *
 * sunDirection は太陽の向き（部屋から見た方向）。左（-X）の窓から斜めに
 * 差し込ませたいので、どのテーマも -X 寄りに置いてある。
 */
export const THEMES = {
  day: {
    label: '昼',
    swatch: 0x8fc9f0,

    skyTop: 0x3b7fd6,
    skyBottom: 0xcfe6f7,
    fog: 0xcfe0ee,
    fogNear: 10,
    fogFar: 48,

    sunColor: 0xfff4e2,
    sunIntensity: 4.2,
    sunDirection: [-9, 7.2, -4.2],

    // 窓の面光源 = 窓から見える空の明るさ
    windowColor: 0xc5dcf4,
    windowIntensity: 3.4,

    ambientSky: 0xbcd4ea,
    ambientGround: 0x6d6459,
    ambientIntensity: 0.40,

    lampColor: 0xffd9a8,
    lampIntensity: 0,

    exposure: 1.0,
  },

  sunset: {
    label: '夕',
    swatch: 0xff9a56,

    skyTop: 0x2c2a55,
    skyBottom: 0xff9c58,
    fog: 0xd98a5c,
    fogNear: 9,
    fogFar: 42,

    sunColor: 0xffa14e,
    sunIntensity: 3.1,
    sunDirection: [-13, 2.3, -3.0],

    windowColor: 0xffb277,
    windowIntensity: 2.2,

    ambientSky: 0xe0a47c,
    ambientGround: 0x3b2c2a,
    ambientIntensity: 0.30,

    lampColor: 0xffce90,
    lampIntensity: 0.55,

    exposure: 1.08,
  },

  night: {
    label: '夜',
    swatch: 0x2b3a6b,

    skyTop: 0x04060f,
    skyBottom: 0x111c3c,
    fog: 0x0a1022,
    fogNear: 8,
    fogFar: 38,

    // 夜の「太陽」は月。青くて弱く、影はうっすら
    sunColor: 0x9fb4ff,
    sunIntensity: 0.45,
    sunDirection: [-7, 6.5, -5.0],

    windowColor: 0x3d4f84,
    windowIntensity: 0.40,

    ambientSky: 0x2a3560,
    ambientGround: 0x080b14,
    ambientIntensity: 0.18,

    lampColor: 0xffc98a,
    lampIntensity: 1.0,

    exposure: 1.28,
  },
};

export const DEFAULT_THEME = 'day';
