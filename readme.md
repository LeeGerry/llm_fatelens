# Digital Human Fortune Chat

面试展示用的 Native AI 项目：一个中文命理角色「陈玉楼大师」聊天应用。

当前形态：

- FastAPI 后端：LangChain Agent、Redis 对话记忆、情绪识别、Azure TTS、工具调用。
- Expo React Native 客户端：一套代码支持 iOS、Android、Web 三端演示。
- 推荐部署：Render 跑 FastAPI，Upstash Redis 保存聊天记忆。

## 架构

```text
Expo React Native App
        |
        | HTTPS / JSON
        v
FastAPI on Render
        |
        +-- DeepSeek: 对话、情绪分类、参数提取
        +-- Upstash Redis: 多轮聊天记忆
        +-- Azure TTS: 语音合成
        +-- SerpAPI / yuanfenju: Agent 工具
        +-- Qdrant local/cloud: 可选知识库检索
```

## 后端本地运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

健康检查：

```bash
curl http://localhost:8000/healthz
```

聊天接口：

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"大师,我最近有点焦虑,想看看事业运","session_id":"demo-user","with_voice":true}'
```

## 移动端本地运行

```bash
cd mobile
npm install
cp .env.example .env
npm run web
```

连接线上后端时，修改 `mobile/.env`：

```bash
EXPO_PUBLIC_API_BASE_URL=https://your-render-service.onrender.com
```

Expo 常用命令：

```bash
npm run ios
npm run android
npm run web
```

## Render 部署后端

1. 把仓库推到 GitHub。
2. 在 Render 新建 Web Service，选择 Docker。
3. 设置 Health Check Path：`/healthz`。
4. 配置环境变量。

必填环境变量：

```bash
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
REDIS_URL=
PUBLIC_BASE_URL=https://your-render-service.onrender.com
CORS_ORIGINS=*
```

如果只是面试演示前后端链路、暂时没有 DeepSeek 额度，可以开启：

```bash
DEMO_MODE=true
```

可选环境变量：

```bash
AZURE_VOICE_KEY=
AZURE_VOICE_REGION=eastus
SERPAPI_API_KEY=
YUANFENJU_API_KEY=
OPENAI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION=local_knowledge
```

注意：当前聊天 LLM 默认使用 DeepSeek；`OPENAI_API_KEY` 只在两种情况下需要：

- 把 `LLM_PROVIDER` 改成 `openai`。
- 调用 `/add_urls` 写入 Qdrant 知识库，因为现有 embedding 仍使用 `text-embedding-3-small`。

如需临时切回 OpenAI-compatible 供应商，可在 `.env` 中调整：

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

## Upstash Redis

在 Upstash 创建 Redis 后，复制 Redis URL 到 Render：

```bash
REDIS_URL=rediss://default:password@host.upstash.io:6379
```

后端会通过 `RedisChatMessageHistory` 使用这个地址保存多轮对话。

## 面试演示脚本

1. 打开 Expo Web 或 iOS Simulator。
2. 输入：「大师，我最近有点焦虑，想看看事业运」。
3. 展示：情绪识别、角色化中文回复、多轮会话记忆。
4. 输入：「我叫张三，1998 年 8 月 8 日上午 9 点出生，帮我看看八字」。
5. 展示：Agent 工具调用和参数抽取。
6. 等待语音状态变为 ready，点击播放语音。
7. 打开代码讲解：客户端没有 API Key，所有 AI/工具/记忆都在云端后端完成。

## API

### `POST /chat`

请求：

```json
{
  "message": "大师,我今年运势如何?",
  "session_id": "demo-user",
  "with_voice": true
}
```

响应：

```json
{
  "reply": "老夫看你此问...",
  "session_id": "demo-user",
  "message_id": "uuid",
  "mood": "anxious",
  "audio_url": "http://localhost:8000/voices/uuid.mp3",
  "audio_status_url": "http://localhost:8000/audio/uuid/status",
  "tools_used": ["bazi_cesuan"]
}
```

### `GET /audio/{id}/status`

返回语音是否生成完成。

### `GET /voices/{filename}`

返回 MP3 文件。面试 MVP 使用本地文件；生产环境建议改为对象存储。

## 备注

这个项目面向面试展示，优先保证链路完整、代码清晰、部署简单。生产化可以继续升级：

- 音频上传到对象存储，而不是存在服务本地磁盘。
- Qdrant 改用 Qdrant Cloud。
- 增加用户登录和历史会话长期保存。
- 增加流式输出和任务队列。
