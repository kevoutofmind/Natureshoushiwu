# MOVE / MATCH · TikTok AI

抖音黑客松网页端项目，方向为多模态视觉搜索、VLM 动作教学与语音控制。当前项目包含注册登录、热门手势舞入口、AI 教学双竖屏工作台、摄像头录制、本地草稿下载，以及浏览器语音输入和简单指令解析。

## 1. 环境依赖

### 1.1 必需软件

| 软件 | 建议版本 | 当前测试版本 | 检查命令 |
| --- | --- | --- | --- |
| Node.js | 20.9 或更高，推荐 Node 22 LTS | 24.17.0 | `node --version` |
| npm | 与 Node.js 配套，建议 10 或更高 | 11.13.0 | `npm --version` |
| Docker Desktop | 较新稳定版 | 29.5.3 | `docker --version` |
| PostgreSQL | 16 | 16.14 Docker 容器 | `docker exec tiktok-ai-postgres psql --version` |
| 浏览器 | 最新 Chrome 或 Edge | 本地浏览器 | 在浏览器“关于”页面检查 |

可选但推荐：

- Git。
- VS Code。
- VS Code ESLint、Prettier 扩展。
- Postman；项目已经提供 Swagger，通常不需要额外安装。

### 1.2 前端依赖

前端依赖由 `ftnd/package.json` 和 `ftnd/package-lock.json` 管理。

| 依赖 | 用途 |
| --- | --- |
| `next` | Next.js App Router |
| `react`、`react-dom` | React 页面和组件 |
| `@mui/material` | Material UI 组件 |
| `@mui/icons-material` | Material UI 图标 |
| `@emotion/react`、`@emotion/styled` | Material UI 样式引擎 |
| `@mediapipe/pose` | 动作关键点能力 |
| `typescript` | TypeScript |
| `eslint`、`eslint-config-next` | 前端代码检查 |

安装前端依赖：

```powershell
cd ftnd
npm ci
```

### 1.3 后端依赖

后端依赖由 `bknd/package.json` 和 `bknd/package-lock.json` 管理。

| 依赖 | 用途 |
| --- | --- |
| `@nestjs/common`、`@nestjs/core` | NestJS 框架 |
| `@nestjs/platform-express` | Express HTTP 适配器 |
| `@nestjs/config` | `.env` 环境变量 |
| `@nestjs/jwt` | JWT 签发和验证 |
| `@nestjs/swagger` | Swagger / OpenAPI 文档 |
| `pg` | PostgreSQL 客户端 |
| `bcryptjs` | 密码哈希 |
| `class-validator`、`class-transformer` | DTO 校验和转换 |
| `rxjs`、`reflect-metadata` | NestJS 运行依赖 |
| `jest`、`supertest` | 单元测试和端到端测试 |
| `eslint`、`prettier` | 代码检查和格式化 |

安装后端依赖：

```powershell
cd bknd
npm ci
```

所有精确版本以两个 `package-lock.json` 为准。推荐使用 `npm ci`，不要删除锁文件后重新安装，以免不同电脑解析出不同版本。

## 2. 首次安装

以下命令以 Windows PowerShell 为例。

### 2.1 获取项目

通过 Git 获取：

```powershell
git clone <项目仓库地址>
cd Tiktok-AI
```

如果使用压缩包，解压后在 VS Code 中打开 `Tiktok-AI` 根目录。

### 2.2 检查环境

```powershell
node --version
npm --version
docker --version
```

如果 `docker` 命令不可用，请安装并启动 Docker Desktop。

### 2.3 安装全部依赖

```powershell
cd C:\Users\<你的用户名>\Desktop\Tiktok-AI\ftnd
npm ci

cd C:\Users\<你的用户名>\Desktop\Tiktok-AI\bknd
npm ci
```

`npm ci` 会按照锁文件安装包括 Material UI、NestJS 和 Swagger 在内的全部依赖，无需逐个执行 `npm install`。

## 3. PostgreSQL

### 3.1 使用已有的 `flight-system-postgres`

本机已经存在该容器时：

```powershell
docker start flight-system-postgres
docker ps
```

确认端口映射中存在：

```text
0.0.0.0:5434->5432/tcp
```

容器中还没有 `tiktok_ai` 数据库时：

```powershell
docker exec flight-system-postgres psql -U flight_user -c "CREATE DATABASE tiktok_ai;"
```

数据库已经存在时会提示重复，不需要删除或重建原数据库。

### 3.2 创建独立 PostgreSQL 容器

没有现成容器时：

```powershell
docker run -d `
  --name tiktok-ai-postgres `
  -e POSTGRES_USER=flight_user `
  -e POSTGRES_PASSWORD=flight_password `
  -e POSTGRES_DB=tiktok_ai `
  -p 5434:5432 `
  -v tiktok-ai-postgres-data:/var/lib/postgresql/data `
  postgres:16
```

检查数据库：

```powershell
docker ps
docker exec tiktok-ai-postgres psql -U flight_user -d tiktok_ai -c "SELECT 1;"
```

停止和再次启动：

```powershell
docker stop tiktok-ai-postgres
docker start tiktok-ai-postgres
```

不要随意删除数据库容器或 `tiktok-ai-postgres-data` 数据卷。

## 4. 环境变量

### 4.1 后端

复制环境变量模板：

```powershell
cd C:\Users\<你的用户名>\Desktop\Tiktok-AI\bknd
Copy-Item .env.example .env
```

`bknd/.env` 示例：

```env
PORT=3001
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://flight_user:flight_password@localhost:5434/tiktok_ai
JWT_SECRET=请替换为随机生成的长字符串
JWT_EXPIRES_IN=7d
```

生成 JWT Secret：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

将命令输出写入 `JWT_SECRET`。

注意：

- 不要提交 `.env`。
- JWT Secret、数据库密码和未来的大模型 API Key 只能保存在后端环境变量中。
- 仅共享环境变量名称和示例，不共享真实密钥。

### 4.2 前端

前端默认请求：

```text
http://localhost:3001/api
```

需要修改后端地址时创建 `ftnd/.env.local`：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api
```

所有以 `NEXT_PUBLIC_` 开头的变量都会暴露给浏览器，禁止将任何密钥放进前端环境变量。

## 5. 启动项目

建议依次启动数据库、后端和前端。

Windows 下也可以在项目根目录执行一键启动脚本。脚本会自动寻找 npm、检查 Docker、启动已有 PostgreSQL 容器，并依次启动后端和前端：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-dev.ps1
```

首次运行仍需先完成第 2～4 节的依赖、数据库和环境变量配置。

### 5.1 启动数据库

根据本机容器名称执行其中一个命令：

```powershell
docker start flight-system-postgres
```

或：

```powershell
docker start tiktok-ai-postgres
```

### 5.2 启动 NestJS 后端

```powershell
cd C:\Users\<你的用户名>\Desktop\Tiktok-AI\bknd
npm run start:dev
```

检查后端：

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

正常返回：

```json
{
  "status": "ok",
  "service": "tiktok-ai-api"
}
```

### 5.3 启动 Next.js 前端

```powershell
cd C:\Users\<你的用户名>\Desktop\Tiktok-AI\ftnd
npm run dev
```

访问地址：

- 首页：<http://localhost:3000>
- 登录：<http://localhost:3000/login>
- 热门手势舞：<http://localhost:3000/popular>
- AI 教学：<http://localhost:3000/teaching>
- 草稿箱：<http://localhost:3000/drafts>

## 6. 技术架构

| 层级 | 技术 | 作用 |
| --- | --- | --- |
| 前端 | Next.js 16、React 19、TypeScript | 页面路由、交互和功能组合 |
| UI | Material UI 6、Emotion | UI 组件、主题和故障艺术视觉 |
| 后端 | NestJS 11、TypeScript | REST API、认证和业务模块 |
| API 文档 | Swagger / OpenAPI | API 文档、调试和契约查看 |
| 数据库 | PostgreSQL 16、`pg` | 用户和后续业务元数据 |
| 认证 | JWT、bcryptjs | 登录状态和密码哈希 |
| 浏览器能力 | MediaRecorder、IndexedDB | 摄像头录制和本地草稿 |
| 视觉依赖 | MediaPipe Pose | 后续动作关键点能力 |

API 在 NestJS Controller 中实现，并统一登记到 Swagger。Swagger 是 API 文档和调试入口，不是业务代码的存放位置。

## 7. 当前功能

- TikTok Pink `#FE2C55`、TikTok Aqua `#25F4EE`、黑白故障艺术主题。
- 邮箱和密码注册、登录、JWT 状态验证和退出登录；用户和密码哈希持久化到 PostgreSQL。
- 密码必须包含至少 1 个英文字母和 1 个数字，最长 72 位且不允许空格。
- 热门手势舞页面采用可滚动数据流，目前不生成模拟视频。
- 从热门舞蹈选择结果携带 `danceId` 进入 AI 教学。
- AI 教学包含原视频和跟练录制两个等大的 `9:16` 竖屏。
- 浏览器摄像头录制。
- IndexedDB 本地草稿预览、删除和下载。
- 浏览器语音转文字，以及暂停、继续、倍速、前后跳转、重新开始和录制等简单指令的后端解析。
- VLM 教学反馈前端契约已支持 `shouldAdvance`、`shouldPause`、`KEEP_WATCHING` 和 `NOT_VISIBLE` 四类视觉反应。
- Swagger UI 和 OpenAPI JSON。

### 7.1 交接边界

| 模块 | 当前状态 | 后续接入点 |
| --- | --- | --- |
| 前端框架 | 登录、导航、热门手势舞、AI 教学和草稿箱页面已连通 | 接入真实舞蹈封面、视频和教学数据后直接替换空数据状态 |
| 用户与数据库 | 注册、登录、JWT、`/users/me` 和 PostgreSQL `users` 表已连通 | 后续业务表由数据结构确定后通过迁移脚本增加 |
| 语音控制 | 麦克风转文字、文字测试、简单意图解析 API 和 Swagger 契约已完成 | 指令已保留回调接口；复杂语义和视频时间轴执行由 VLM、video-stage 联调 |
| AI 教学与录制 | 双竖屏、摄像头录制、保存草稿、视觉反馈适配器已完成 | 原视频播放、动作切片、VLM 推理结果由对应模块提供 |
| 草稿箱 | 录制结果使用 IndexedDB 本地保存，可预览、删除和下载 | 当前不上传服务器；需要云草稿时再新增存储 API 和业务表 |

当前仓库是可以独立运行和继续集成的产品基础版本。VLM 推理、真实视频数据、动作切片和云端媒体存储仍属于后续团队模块，README 不将这些尚未接入的能力标记为已完成。

## 8. 项目目录

```text
Tiktok-AI/
├─ ftnd/                         # Next.js 前端
│  ├─ src/
│  │  ├─ app/                    # App Router 页面和布局
│  │  ├─ components/
│  │  │  └─ navigation/         # 顶部导航和登录保护
│  │  ├─ features/
│  │  │  ├─ popular-dances/     # 热门手势舞
│  │  │  ├─ ai-teaching/        # AI 教学页面组合
│  │  │  ├─ video-stage/        # 视频舞台功能骨架
│  │  │  ├─ voice-control/      # 浏览器语音输入
│  │  │  └─ drafts/             # IndexedDB 草稿
│  │  ├─ lib/                    # 认证客户端等通用代码
│  │  └─ theme/                  # Material UI 主题
│  ├─ package.json
│  └─ package-lock.json
├─ bknd/                         # NestJS 后端
│  ├─ db/
│  │  ├─ 001_create_users.sql   # users 表初始化 SQL
│  │  └─ migrations/            # 后续数据库迁移
│  ├─ src/
│  │  ├─ database/              # PostgreSQL 连接池
│  │  ├─ data-pipeline/         # 数据导入、清洗和整合骨架
│  │  ├─ media-assets/          # 媒体资源元数据骨架
│  │  ├─ vlm-core/              # Prompt、模型 Provider 和分析契约
│  │  ├─ video-stage/           # 视频处理和时间轴后端骨架
│  │  ├─ voice-control/         # 简单语音指令解析 API
│  │  ├─ users/                 # 注册、登录和 JWT
│  │  ├─ popular-dances/        # 热门手势舞 API
│  │  ├─ ai-teaching/           # AI 教学组合 API
│  │  └─ drafts/                # 草稿状态 API
│  ├─ .env.example
│  ├─ package.json
│  └─ package-lock.json
└─ README.md
```

## 9. Swagger / OpenAPI

后端启动后访问：

- Swagger UI：<http://localhost:3001/api/docs>
- OpenAPI JSON：<http://localhost:3001/api/openapi.json>

当前接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| POST | `/api/users/signup` | 注册并返回 JWT |
| POST | `/api/users/login` | 登录并返回 JWT |
| GET | `/api/users/me` | 验证 JWT 并返回用户 |
| GET | `/api/popular-dances` | 获取热门舞蹈列表 |
| GET | `/api/ai-teaching/workspace` | 获取教学工作区状态 |
| GET | `/api/drafts` | 获取草稿存储状态 |
| POST | `/api/voice/commands/interpret` | 解析简单语音指令并返回结构化意图 |

### 9.1 在 Swagger 中测试登录

1. 展开 `POST /api/users/signup` 或 `POST /api/users/login`。
2. 点击 `Try it out`。
3. 输入邮箱和密码。
4. 点击 `Execute`。
5. 从响应中复制 `data.accessToken`。
6. 点击页面右上角 `Authorize`。
7. 粘贴 Token 并确认。
8. 执行 `GET /api/users/me`。

Swagger 已开启 `persistAuthorization`，刷新页面时会尽量保留当前授权信息。

### 9.2 新增 API 规范

新增 REST API 时应：

1. 在对应 NestJS 模块中实现 Controller 和 Service。
2. Controller 添加 `@ApiTags()`。
3. 接口添加 `@ApiOperation()` 和对应的 `@ApiResponse()`。
4. 请求 DTO 添加 `class-validator` 校验和 `@ApiProperty()`。
5. 需要 JWT 的接口添加 `@ApiBearerAuth('jwt')`。
6. 在 Swagger UI 中实际执行接口。
7. 确认 `/api/openapi.json` 中存在对应路径。

## 10. 数据库

当前业务表只有 `users`：

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

邮箱使用 `LOWER(email)` 唯一索引，避免大小写不同造成重复账号。NestJS 启动时会安全执行 `CREATE TABLE IF NOT EXISTS`。

初始化 SQL：

```text
bknd/db/001_create_users.sql
```

当前没有热门舞蹈、动作标注、VLM 结果或视频文件数据，不要添加随机模拟记录。

后续建议：

- PostgreSQL 保存视频元数据、文件地址、时间轴、标签和 JSONB 分析结果。
- 原始视频保存在对象存储或受管理的本地文件目录。
- 数据库结构变化通过迁移脚本维护，不直接手工修改共享数据库。

## 11. 构建和检查

前端：

```powershell
cd ftnd
npm run lint
npm run build
```

后端：

```powershell
cd bknd
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

生产模式：

```powershell
cd bknd
npm run build
npm run start:prod
```

```powershell
cd ftnd
npm run build
npm run start
```

## 12. 安全说明

- 禁止提交 `.env`、`.env.local`、JWT Secret 和大模型 API Key。
- 数据库只保存密码哈希，不保存明文密码。
- 模型 Key 只能放在 NestJS 后端。
- 前端不得直接调用需要私钥的大模型接口。
- Swagger 示例 Token 和账号必须使用假数据。
- 正式公开部署时，应限制 Swagger 访问或按环境关闭。
