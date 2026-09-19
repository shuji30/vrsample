/**
 * 環境テーマ（昼 / 夕方 / 夜）の定義。
 * ワールド内のボタンから切り替える。
 */
export const THEMES = {
  day: {
    label: '昼',
    swatch: 0x7ec8ff,
    skyTop: 0x2a6bd4,
    skyBottom: 0xbfe4ff,
    fog: 0xbfe4ff,
    ground: 0x6f7f92,
    grid: 0xffffff,
    hemiSky: 0xbfe4ff,
    hemiGround: 0x4a5568,
    sun: 0xfff4e0,
    sunIntensity: 2.6,
    accent: 0x36d1c4,
    pillar: 0x8b97a8,
  },
  sunset: {
    label: '夕',
    swatch: 0xff9a56,
    skyTop: 0x2b2050,
    skyBottom: 0xff9a56,
    fog: 0xd97a52,
    ground: 0x5a4450,
    grid: 0xffd0a0,
    hemiSky: 0xffb07a,
    hemiGround: 0x3a2a38,
    sun: 0xffb066,
    sunIntensity: 2.0,
    accent: 0xffd166,
    pillar: 0x7a5a5e,
  },
  night: {
    label: '夜',
    swatch: 0x2b3a6b,
    skyTop: 0x04060f,
    skyBottom: 0x16224a,
    fog: 0x0b1024,
    ground: 0x28304a,
    grid: 0x5f7bd0,
    hemiSky: 0x3a4a8c,
    hemiGround: 0x0a0e1c,
    sun: 0x93a7ff,
    sunIntensity: 0.7,
    accent: 0x8ef0ff,
    pillar: 0x3a456a,
  },
};

export const DEFAULT_THEME = 'day';
