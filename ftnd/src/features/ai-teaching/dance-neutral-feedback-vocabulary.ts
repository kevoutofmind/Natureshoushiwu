export interface DanceNeutralFeedbackVocabulary {
  title: string;
  overall: readonly string[];
  actions: readonly (readonly string[])[];
}

export const DANCE_NEUTRAL_FEEDBACK_VOCABULARY: Readonly<
  Record<string, DanceNeutralFeedbackVocabulary>
> = {
  "dance-001": {
    title: "cat",
    overall: ["猫系手势再轻松一点", "上半身保持自然一点"],
    actions: [
      ["双食指在胸前对得整齐一点", "猫爪张开得自然一点"],
      ["双拳推出和收回再干净一点", "两拳换位时层次清楚一点"],
      ["学的更像小猫一点", "贴脸的小拳再放松一点"],
      ["点脸的手势轻一点", "送吻到收爪连接得自然一点"],
    ],
  },
  "dance-002": {
    title: "cloud",
    overall: ["整套手势保持柔和一点", "手腕线条再流畅一点"],
    actions: [
      ["双掌向胸前内收得柔和一点", "两掌之间留一点空间"],
      ["托下巴的手掌再放松一点", "下巴轻轻靠近掌根一点"],
      ["翻腕的波浪再连贯一点", "点脸时手指轻一点"],
      ["脸侧托花的位置再对称一点", "收尾时手腕保持自然一点"],
    ],
  },
  "dance-003": {
    title: "fade",
    overall: ["动作收放再从容一点", "肩膀和手腕都放松一点"],
    actions: [
      ["预备时双手再放松一点", "前推时双掌保持平行一点"],
      ["沿脸侧上划的路线再顺一点", "另一只手保持稳定一点"],
      ["左右拳交替得清楚一点", "拳头上摆的幅度均匀一点"],
      ["双掌收到肩侧再自然一点", "最后定格时胸口打开一点"],
    ],
  },
  "dance-004": {
    title: "fight",
    overall: ["手势力量保持轻巧一点", "动作线条再利落一点"],
    actions: [
      ["胸前合掌的位置再居中一点", "手指对齐得自然一点"],
      ["推掌路线再直接一点", "双手上扬的弧线再打开一点"],
      ["脸侧的 V 形再清楚一点", "比耶时手腕朝向镜头一点"],
      ["双手交叉的位置再居中一点", "收回下落时再从容一点"],
    ],
  },
  "dance-005": {
    title: "indo",
    overall: ["快速手势之间再清楚一点", "脸部和手势配合自然一点"],
    actions: [
      ["横扫胸前的路线再平一点", "捏指向外拉时两边均匀一点"],
      ["双食指在脸旁再对称一点", "向镜头点拳时轻一点"],
      ["食指上提和眨眼配合自然一点", "虎口框脸的位置再居中一点"],
      ["双手交叠得放松一点", "侧倾收尾时颈肩自然一点"],
    ],
  },
  "dance-006": {
    title: "no",
    overall: ["整套拒绝手势再从容一点", "眼神和手势连接自然一点"],
    actions: [
      ["预备时双手再放松一点", "侧看后回到中间自然一点"],
      ["食指左右轻摆的幅度小一点", "摆动时手肘稳定一点"],
      ["双掌抬到脸前再对称一点", "向外推时五指打开一点"],
      ["托脸时掌心再放松一点", "歪头收尾时肩膀放松一点"],
    ],
  },
};

export function getDanceNeutralFeedbackVocabulary(
  danceId: string | undefined,
): DanceNeutralFeedbackVocabulary | null {
  if (!danceId) return null;
  return DANCE_NEUTRAL_FEEDBACK_VOCABULARY[danceId] ?? null;
}