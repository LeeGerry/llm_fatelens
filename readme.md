# Digital Human Fortune Chat

面试展示用的 Native AI 项目：一个中文命理角色「陈玉楼大师」聊天应用。项目重点不是“算命准确”，而是展示一个可运行、可部署、带移动端体验的 AI Native 产品闭环。

## 项目亮点

- **Expo React Native 三端客户端**：一套代码支持 Android、iOS、Web。
- **FastAPI AI 后端**：统一承接 LLM、工具调用、记忆、TTS 和安全边界。
- **真实流式输出**：移动端通过 SSE 获取后端实时增量回复。
- **Redis 多轮记忆**：支持按 session 保存对话上下文，并在历史过长时做摘要。
- **DeepSeek 对话模型**：OpenAI-compatible 调用方式，适合低成本面试演示。
- **Agent 工具调用**：八字测算、摇卦、本地知识库、联网搜索；Agent 路径返回工具调用标签。
- **Azure TTS 语音合成**：AI 回复生成 MP3，支持手动播放、停止、重播和自动播放。
- **八字快捷表单**：姓名、性别、公历/农历、出生日期、出生时间、出生城市结构化采集。
- **Prompt 安全边界**：避免恐吓、绝对化医疗/投资建议，对敏感情绪做安抚和求助建议。
- **面试友好的工程结构**：后端拆分为 `main/services/tools/config/errors/schemas`，配置启动校验清晰。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Mobile/Web | Expo, React Native, TypeScript |
| API | FastAPI, Uvicorn |
| AI Orchestration | LangChain Agent, OpenAI-compatible Chat API |
| LLM | DeepSeek by default, OpenAI-compatible fallback |
| Memory | Redis / Upstash Redis |
| Voice | Azure Speech TTS, expo-audio |
| Tools | yuanfenju 八字/摇卦 API, SerpAPI, Qdrant |
| Deploy | Render Docker Web Service, Expo local/device demo |

## 架构

```text
Expo React Native App
  |-- Chat UI / history / settings
  |-- BaZi structured form
  |-- SSE streaming client
  |-- Audio playback
        |
        | HTTPS / JSON / SSE
        v
FastAPI backend on Render
  |-- DeepSeek chat + emotion classifier
  |-- LangChain Agent + tool usage tracker
  |-- SSE direct streaming for mobile
  |-- Redis chat memory
  |-- Azure TTS background synthesis
  |-- Voice file serving and status polling
        |
        +-- Upstash Redis
        +-- Azure Speech
        +-- yuanfenju APIs
        +-- SerpAPI
        +-- Qdrant local/cloud
```

## 目录结构

```text
app/
  main.py                 FastAPI app, routes, SSE endpoints
  config.py               environment-driven config
  errors.py               unified error payload helpers
  schemas.py              API request/response models
  prompts.py              role prompt, safety guardrails, parameter prompts
  services/
    master.py             LangChain Agent, streaming, memory orchestration
    memory.py             Redis history and summarization
    voice.py              Azure TTS and audio job state
  tools/                  exported LangChain tools
  MyTools.py              tool implementations
mobile/
  App.tsx                 main React Native app shell
  src/components/         chat bubble, composer, audio button
  src/api/client.ts       API/SSE client
  src/utils/              local session/profile storage
  src/i18n.ts             Chinese/English UI strings
```

## Local Quick Start

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://localhost:8000/healthz
```

Mobile/Web:

```bash
cd mobile
npm install
cp .env.example .env
npm run web
```

Android device demo:

```bash
cd mobile
npm run android:native
```

If testing on a real phone, set `mobile/.env` to your computer LAN IP:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
```

## Environment Variables

Backend uses `.env` at the project root.

Required for the full demo:

```bash
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
REDIS_URL=redis://localhost:6379/0
PUBLIC_BASE_URL=http://localhost:8000
CORS_ORIGINS=*
```

Voice and tools:

```bash
AZURE_VOICE_KEY=
AZURE_VOICE_REGION=eastus
YUANFENJU_API_KEY=
SERPAPI_API_KEY=
```

Optional:

```bash
DEMO_MODE=false
OPENAI_API_KEY=
QDRANT_PATH=./local_qdrant
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION=local_knowledge
```

Notes:

- `DEMO_MODE=true` skips external LLM calls and is useful when interview Wi-Fi or quota is unreliable.
- `OPENAI_API_KEY` is only needed when switching LLM provider to OpenAI or using `/add_urls`, because embeddings still use OpenAI.
- `PUBLIC_BASE_URL` must be the externally reachable API URL so audio URLs work on mobile devices.

## API Highlights

### `POST /chat`

Standard non-streaming chat endpoint.

```json
{
  "message": "大师,我最近有点焦虑,想看看事业运",
  "session_id": "demo-user",
  "with_voice": true
}
```

Response includes mood, audio status URL, and tools used. This is the Agent-backed path.

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

### `POST /chat/stream/start`

Starts a mobile-friendly SSE stream and returns a stream id.

This path prioritizes low-latency streaming. It currently streams direct model replies and may return an empty `tools_used` list unless running in demo mode or extended to stream Agent tool events.

### `GET /chat/stream/{stream_id}/events`

Returns SSE events:

- `start`: message id, mood, tools used if known
- `delta`: incremental text
- `done`: final audio status URL
- `error`: unified error payload

### `GET /audio/{id}/status`

Returns voice generation state: `pending`, `ready`, or `failed`.

### `GET /voices/{filename}`

Serves generated MP3 files. For a production version, move these files to object storage.

## Interview Demo Script

1. Open the Android app or Expo Web app.
2. Send: `大师，我最近有点焦虑，想看看事业运`.
3. Show SSE streaming text, mood label, and voice generation status.
4. Turn on auto-play voice in settings, send another message, and show automatic TTS playback.
5. Open the BaZi form and fill name, gender, calendar type, birth date, birth time, and city.
6. Submit the BaZi form and show the structured prompt path.
7. For tool tracking, call or demo the Agent-backed `/chat` path and show the productized tool tag, for example `已调用八字测算`.
8. Open backend code:
   - `app/services/master.py` for Agent/streaming/tool tracking.
   - `app/services/memory.py` for Redis memory.
   - `app/services/voice.py` for TTS.
   - `app/prompts.py` for safety guardrails.
9. Explain that mobile clients never hold AI/API keys; all sensitive work happens on the backend.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for local, Render, Upstash Redis, and Expo device deployment steps.

## Current Production Tradeoffs

This is intentionally optimized for interview demo speed. If productionizing:

- Move generated MP3 files from local `voices/` to object storage.
- Replace local Qdrant with Qdrant Cloud.
- Add real authentication and per-user cloud history.
- Add backend tests for prompt safety, TTS sanitization, and tool parameter extraction.
- Add global FastAPI exception handlers for fully uniform error responses.
