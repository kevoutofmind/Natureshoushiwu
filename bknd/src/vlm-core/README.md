# VLM Core：固定手势舞实时判别

本模块负责黑客松版本中约 5 支预设手势舞的动作判别。核心原则：

- 实时 `accept` 完全在本地完成，不等待 Prompt 或云端 VLM。
- 每支舞可以有不同数量、不同长度的语义动作单元。
- 每个动作单元使用多名正确表演者的骨骼序列作为参考模板。
- 判定从宽：相近动作允许通过并给温和提示，只有明显偏离才重做。
- 看不清、动作尚未完成时不判错。
- 云端 VLM只用于赛前拆动作和生成教学语言，不能控制实时推进。

## 运行流程

```text
赛前：
正确参考视频
  -> AI按语义自动拆分动作单元
  -> 视觉模块提取 MediaPipe Pose + 双手21点
  -> 注册多参考骨骼模板

练习时：
摄像头骨骼序列
  -> 本地归一化（位置、人体尺度、镜像、时间）
  -> 与同一动作单元的多条正确模板比较
  -> ACCEPT / ACCEPT_HINT / RETRY / KEEP_WATCHING / NOT_VISIBLE
```

多参考匹配取最相近的正确表演者，允许不同人的正常动作差异。

## API

主应用导入 `VlmCoreModule` 后提供：

```text
GET  /api/vlm-core/health
POST /api/vlm-core/templates/register
POST /api/vlm-core/realtime/decide
POST /api/vlm-core/analyze          # 旧版测量协议兼容入口
```

项目的全局 API 前缀由主应用决定，示例使用 `/api`。

### 1. 赛前注册动作模板

每个动作单元注册一次。参考骨骼应从动作开始持续到动作结束，不是单张关键帧。

```json
{
  "schemaVersion": "motion-template-pack-v1",
  "danceId": "dance-001",
  "motionId": "motion-002",
  "motionName": "双手向外打开",
  "instruction": "双手放在肩膀附近，然后平滑向外打开。",
  "expectedDurationMs": 3000,
  "requiredParts": ["pose", "left_hand", "right_hand"],
  "evaluationPolicy": {
    "acceptThreshold": 0.78,
    "acceptWithHintThreshold": 0.55,
    "minimumCompletionProgress": 0.82,
    "minimumObservationMs": 450
  },
  "templates": [
    {
      "templateId": "person-a-take-1",
      "sourceVideoId": "reference-video-a",
      "mirrored": false,
      "frames": []
    },
    {
      "templateId": "person-b-take-1",
      "sourceVideoId": "reference-video-b",
      "mirrored": false,
      "frames": []
    }
  ]
}
```

每个 `SkeletonFrame`：

```json
{
  "timestampMs": 100,
  "pose": [{ "x": 0.42, "y": 0.31, "z": -0.02, "visibility": 0.98 }],
  "leftHand": [{ "x": 0.21, "y": 0.43, "z": 0.01 }],
  "rightHand": [{ "x": 0.79, "y": 0.43, "z": 0.01 }]
}
```

要求：

- `pose` 使用 MediaPipe Pose 顺序，至少17点，推荐完整33点。
- `leftHand`、`rightHand` 使用 MediaPipe Hand 顺序，各21点。
- 时间戳非负并单调递增。
- `requiredParts` 应按动作设置；某个动作只要求右手时，不要强制左手可见。
- `mirrored` 表示产生关键点的图像是否已经镜像。

模板目前保存在进程内存中。后端重启后，参考数据负责人需要重新注册。

### 2. 实时判别

`frames` 必须是从当前语义动作单元开始，到当前进度为止的骨骼序列。视觉模块可以降采样到约 10–15 FPS，无需发送原始视频。

```json
{
  "schemaVersion": "realtime-judge-v1",
  "sessionId": "session-001",
  "sampleId": "sample-00038",
  "danceId": "dance-001",
  "motionId": "motion-002",
  "attemptIndex": 1,
  "observation": {
    "mirrored": true,
    "progress": 0.9,
    "frames": []
  }
}
```

响应：

```json
{
  "schemaVersion": "realtime-decision-v1",
  "decision": "ACCEPT_HINT",
  "reason": "CLOSE_ENOUGH",
  "speech": "动作基本完成，下一步注意右手手型，我们继续。",
  "shouldAdvance": true,
  "shouldPause": false,
  "confidence": 0.71,
  "bestTemplateId": "person-b-take-1",
  "weakestPart": "right_hand",
  "scores": {
    "overall": 0.71,
    "pose": 0.82,
    "leftHand": 0.76,
    "rightHand": 0.58,
    "trajectory": 0.73,
    "visibility": 0.96
  },
  "metadata": {
    "engine": "local-skeleton-template",
    "engineVersion": "template-matcher-v1.0.0",
    "referenceCount": 2,
    "latencyMs": 2,
    "cloudCalled": false
  }
}
```

## 决策含义

```text
ACCEPT         动作匹配，立即进入下一动作
ACCEPT_HINT    基本完成，给温和提示但仍然进入下一动作
RETRY          动作完成后仍明显偏离，重做当前动作
KEEP_WATCHING  动作进度不足或观察时间太短，继续实时观察
NOT_VISIBLE    关键骨骼看不清，不判为动作错误，也不强制暂停
```

默认阈值位于 `rules/template-matcher.config.ts`：

```text
overall >= 0.78            ACCEPT
0.55 <= overall < 0.78     ACCEPT_HINT
overall < 0.55             RETRY（仅在动作接近完成后）
progress < 0.82            KEEP_WATCHING
观察不足 450 ms             KEEP_WATCHING
需要的骨骼不可见             NOT_VISIBLE
```

这些是宽松的黑客松初值。10条用户视频到达后，应以“正确动作误重做率最低”为第一目标调阈值。

## 匹配方式

实时引擎会：

1. 根据肩膀中心和肩宽归一化上半身骨骼；
2. 根据手腕和掌长归一化每只手的21点；
3. 自动处理参考和用户之间的镜像差异；
4. 将不同帧数的序列等间隔采样到统一长度；
5. 分别计算姿态、左手、右手和手腕运动轨迹相似度；
6. 与所有正确参考比较，采用最佳匹配结果。

它不会使用背景、衣服、人脸或原始RGB特征，因此适合少数据、固定舞蹈的比赛版本。

## 云端边界

`providers/` 和 `prompts/` 仍保留，用于未来的赛前教学内容生成。以下接口不会调用云端：

```text
POST /templates/register
POST /realtime/decide
POST /analyze
```

因此云端超时、断网或未配置 API Key，不会阻塞动作推进。

## 教学编排 Agent

`agent/` 内实现了一个有状态、工具化、可追踪的 Teaching Agent。它采用适合固定课程的混合架构：

```text
确定性教学状态机
  ├─ 本地骨骼判别工具：唯一有权决定动作是否通过
  ├─ 播放器工具：向 H5 输出播放、暂停、慢放命令
  ├─ 语音工具：输出需要播报的教学文本
  ├─ 云端辅导工具：重复失败后异步改写解释
  └─ 云端总结工具：完整挑战结束后异步生成总结
```

实时观察不会交给大模型规划。Agent 只在明确的课程状态之间转换：

```text
PREVIEW
  -> MOTION_DEMO
  -> PRACTICE
       ├─ ACCEPT / ACCEPT_HINT -> 下一动作
       ├─ RETRY -> 慢速示范后重试
       └─ 多次失败 -> 异步云端辅导 + 平滑进入下一动作
  -> FULL_CHALLENGE
  -> COMPLETED
```

任何阶段都可以通过本地语音指令进入 `PAUSED`，并支持：

```text
PAUSE
RESUME
PREVIOUS_ACTION
REPEAT_ACTION
NEXT_ACTION
RESTART_LESSON
```

### Agent API

```text
GET  /api/vlm-core/agent/prompts
POST /api/vlm-core/agent/prompts/execute
POST /api/vlm-core/agent/lessons/register
POST /api/vlm-core/agent/sessions/start
POST /api/vlm-core/agent/sessions/event
GET  /api/vlm-core/agent/sessions/:sessionId
```

先注册动作骨骼模板，再注册有序课程计划：

```json
{
  "schemaVersion": "teaching-lesson-plan-v1",
  "danceId": "dance-001",
  "title": "预设手势舞一",
  "referenceVideoId": "reference-video-a",
  "previewStartMs": 0,
  "previewEndMs": 15000,
  "policy": {
    "maxRetriesPerMotion": 2,
    "allowVoiceSkip": true,
    "autoAdvanceAfterMaxRetries": true
  },
  "motions": [
    {
      "motionId": "motion-001",
      "instruction": "双手放在肩膀附近，右手比耶。",
      "demoStartMs": 0,
      "demoEndMs": 3200,
      "demoPlaybackRate": 0.7
    }
  ]
}
```

启动会话：

```json
{
  "schemaVersion": "teaching-agent-start-v1",
  "sessionId": "session-001",
  "danceId": "dance-001"
}
```

Agent 返回的 `commands` 是给 H5 执行的结构化工具命令，例如：

```json
{
  "commandId": "session-001-cmd-2",
  "tool": "PLAY_MOTION_DEMO",
  "arguments": {
    "motionId": "motion-001",
    "startMs": 0,
    "endMs": 3200,
    "playbackRate": 0.7,
    "bgm": false
  },
  "requiresAck": true,
  "blocking": true
}
```

播放器完成后发送 `PREVIEW_FINISHED` 或 `MOTION_DEMO_FINISHED`；视觉模块持续发送 `REALTIME_OBSERVATION`；语音模块发送 `VOICE_COMMAND`。

每个事件都必须有唯一 `eventId`。Agent 保存已经处理的结果，重复提交不会推进两次。客户端可以带 `expectedVersion`，防止摄像头、播放器和语音事件乱序覆盖状态。

### Agent 护栏

- 云端输出没有 `accept`、暂停、跳转权限。
- `REALTIME_OBSERVATION` 只调用本地 `judgeRealtime`。
- 单次 Agent turn 最多输出8条工具命令。
- 无效状态转换会被拒绝。
- 重复事件按 `eventId` 幂等返回。
- 所有 turn 返回状态变化、选择的工具、延迟和策略版本 trace。
- 会话与课程计划目前保存在进程内存，后端重启后需重新注册和开始。

## Prompt 管理

Agent Prompt 不是散落字符串，而是集中在 `prompts/teaching-agent.prompt-catalog.ts` 中的版本化资产：

```text
reference-dance-analysis-v1.0.0
adaptive-motion-coaching-v1.0.0
lesson-session-summary-v1.0.0
```

每个 Prompt 固定：

- `promptId` 和不可含糊的版本号；
- 独立用途和 system 指令；
- JSON 输出 Schema；
- 温度、超时、最大输出长度；
- 禁止控制播放器和实时推进的护栏；
- 输入使用 `<INPUT_JSON>` 边界序列化，视为不可信数据；
- 输出必须包含规定字段且不能包含 `shouldAdvance`、`shouldPause` 等控制字段。

查看当前 Prompt 版本：

```text
GET /api/vlm-core/agent/prompts
```

调用云端慢路径：

```json
{
  "schemaVersion": "managed-prompt-execution-v1",
  "promptId": "adaptive-motion-coaching",
  "payload": {
    "danceId": "dance-001",
    "motionId": "motion-002",
    "localDecision": {}
  }
}
```

该调用可以耗时数秒，因此 H5 必须异步执行。实时教学继续推进；结果到达后，以 `CLOUD_COACHING_READY` 事件回送 Agent。即使云端失败，本地课程状态也不会回滚。

`reference-dance-analysis` 用于赛前处理五支预设舞蹈；`adaptive-motion-coaching` 只在重复失败后改写教学解释；`lesson-session-summary` 只在完整挑战结束后总结。

## 对接职责

视觉负责人交付：

- AI切分后的 `danceId / motionId / startMs / endMs`；
- 每个动作单元的正确参考骨骼序列；
- 用户实时的 Pose 33点、左右手各21点；
- 镜像状态和当前动作进度。

VLM Core交付：

- 多参考模板注册和管理；
- 本地骨骼归一化与匹配；
- 宽松的实时判别；
- 结构化教学决策和相似度明细。

H5负责人消费：

- `shouldAdvance=true`：进入下一动作；
- `shouldPause=true`：重播当前慢速示范；
- `KEEP_WATCHING`：保持当前流程；
- `NOT_VISIBLE`：提示调整位置，不记作动作失败。

## 测试

在 `bknd` 目录运行：

```powershell
npm.cmd test -- --runInBand --runTestsByPath src/vlm-core/prompts/managed-prompt-executor.service.spec.ts src/vlm-core/prompts/prompt-catalog.service.spec.ts src/vlm-core/agent/teaching-agent.service.spec.ts src/vlm-core/rules/geometry-rule.engine.spec.ts src/vlm-core/rules/skeleton-template-matcher.engine.spec.ts src/vlm-core/vlm-core.service.spec.ts
```

当前测试覆盖：

- 正确多参考匹配通过；
- 动作未完成时继续观察；
- 遮挡时不误判为错误；
- 明显偏离时重做；
- 旧接口保持兼容；
- 所有实时路径都不调用云端。
- 教学 Agent 从完整演示到逐动作教学再到完整挑战；
- 语音/播放器/视觉事件的会话版本和幂等处理；
- 重复失败后异步请求云端辅导；
- 云端辅导不能改变教学进度；
- Prompt 版本、输入边界、结构化输出与控制字段护栏。

## 集成限制

本目录遵守只修改 `bknd/src/vlm-core` 的边界，因此没有修改主应用模块。主项目负责人仍需在本目录之外将 `VlmCoreModule` 导入后端主模块，路由才会生效。
