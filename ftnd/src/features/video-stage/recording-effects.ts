export const RECORDING_EFFECT_IDS = [
  "original",
  "clear",
  "soft",
  "cream",
  "peach",
  "cool",
  "film",
  "vintage",
  "dream",
  "spotlight",
  "crisp",
] as const;

export type RecordingEffectId = (typeof RECORDING_EFFECT_IDS)[number];

export type RecordingEffectPreset = {
  id: RecordingEffectId;
  label: string;
  description: string;
  swatch: string;
};

export type BeautySettings = {
  skinSmooth: number;
  brightness: number;
  faceSlim: number;
  eyeEnlarge: number;
};

export const DEFAULT_BEAUTY_SETTINGS: BeautySettings = {
  skinSmooth: 0,
  brightness: 0,
  faceSlim: 0.18,
  eyeEnlarge: 0.1,
};

export const RECORDING_EFFECTS: RecordingEffectPreset[] = [
  { id: "original", label: "原片", description: "不加滤镜", swatch: "#f6f6f4" },
  { id: "clear", label: "清透", description: "明亮通透", swatch: "#dffcff" },
  { id: "soft", label: "柔雾", description: "轻柔肤感", swatch: "#fce2e9" },
  { id: "cream", label: "奶油", description: "低对比柔光", swatch: "#ffe9cc" },
  { id: "peach", label: "蜜桃", description: "暖调元气", swatch: "#ffc2b8" },
  { id: "cool", label: "冷白", description: "清冷明亮", swatch: "#c7e8ff" },
  { id: "film", label: "胶片", description: "颗粒质感", swatch: "#c6b49e" },
  { id: "vintage", label: "复古", description: "暖棕旧片", swatch: "#b78f6a" },
  { id: "dream", label: "梦幻", description: "柔焦氛围", swatch: "#e4d7ff" },
  { id: "spotlight", label: "聚光", description: "舞台高光", swatch: "#fff1a8" },
  { id: "crisp", label: "清晰", description: "轮廓增强", swatch: "#dce4ec" },
];
