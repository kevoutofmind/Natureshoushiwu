# Voice Control

负责人：整体框架与语音开发者。

职责：

- 接收前端语音转写或音频请求。
- 语音识别服务适配。
- 将自然语言映射为暂停、继续、慢放、回退和动作拆解意图。
- 把统一命令交给 AI Teaching 或 Video Stage。

该目录只保存后端逻辑和密钥，浏览器麦克风交互位于前端 `features/voice-control`。
