# AGENTS.md

本文件为 Codex (Codex.ai/code) 提供在此仓库中工作的指导。

## 项目概述

本项目是一个中文算命 AI 聊天机器人（角色为"陈玉楼"大师），提供 REST API 和 Telegram 两种接入方式。融合了 LangChain Agent、本地向量知识库、外部占卜 API 以及 Azure TTS 语音合成。

## 运行方式

```bash
# 安装依赖
pip install -r requirements.txt

# 启动 FastAPI 服务（http://127.0.0.1:8000）
python app/server.py

# 启动 Telegram 机器人（独立进程，需先启动服务端）
python app/tele.py
```

## 必要环境变量（`.env`）

- `OPENAI_API_KEY` — GPT-4.1-mini 及 text-embedding-3-small
- `SERPAPI_API_KEY` — SerpAPI 网络搜索
- `AZURE_VOICE_KEY` — Azure 认知服务 TTS
- `TELEGRAM_BOT_TOKEN` — Telegram 机器人

## 依赖服务

- **Redis**：`redis://localhost:6379/0` — 对话历史存储
- **Qdrant**（本地）：`./local_qdrant` — 向量知识库

## 架构说明

### 核心：`app/server.py`

`Master` 类是整个系统的核心调度器：

- **情绪系统** — 对用户消息进行情绪分类（default/depressed/friendly/angry/upbeat/anxious/happy），情绪结果驱动 Azure TTS 的语音风格
- **记忆管理** — 基于 Redis 的 `RedisChatMessageHistory`；当历史消息超过 10 条时，由 LLM 自动摘要并保留关键用户信息（如生辰八字等）
- **Agent** — LangChain `AgentExecutor` 绑定 OpenAI tools；`ConversationBufferMemory` 上限 1000 tokens

### 工具：`app/MyTools.py`

Agent 可调用的四个 LangChain 工具：

| 工具 | 说明 |
|------|------|
| `get_local_knowledge` | Qdrant 向量检索（星座运势、风水知识等） |
| `search` | SerpAPI 实时网络搜索 |
| `bazi_cesuan` | yuanfenju.com API — 八字测算 |
| `yaoyigua` | yuanfenju.com API — 摇一卦占卜 |

### API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/chat` | POST | 主接口，返回文字回复并在后台生成 Azure TTS 语音 MP3 |
| `/add_urls` | POST | 抓取网页内容并写入 Qdrant 知识库 |
| `/add_pdfs` | POST | 存根，未实现 |
| `/add_texts` | POST | 存根，未实现 |
| `/ws` | WebSocket | 基础回声接口 |

### Telegram 机器人：`app/tele.py`

轮询 Telegram 消息，转发至 `/chat` 接口，获取文字回复后轮询等待 MP3 文件生成，再将文字和语音一并发送给用户。

### 数据流

```
用户消息 → 情绪分类 → LangChain Agent（工具选择）
    → [Qdrant / SerpAPI / yuanfenju.com] → LLM 生成回复
    → Azure TTS（基于情绪的 SSML 语音风格）→ MP3
    → 文字 + 语音回复
```

语音文件写入 `voices/` 目录（已加入 .gitignore）。`/chat` 响应包含 `voice` 字段存放文件名，Telegram 机器人轮询等待该文件生成后发送。
