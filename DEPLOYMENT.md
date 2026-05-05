# Deployment Guide

This guide keeps the interview setup boring on purpose: FastAPI on Render, Redis on Upstash, and Expo for Android/iOS/Web demos.

## 1. Local Backend

Create the Python environment:

```bash
cd /Users/gerry/llm_projects/digital_human
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Start Redis locally. If Docker Desktop is running:

```bash
docker compose up -d redis
```

If Docker is not available, either install Redis locally or use an Upstash `REDIS_URL` in `.env`.

Start the API:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Verify:

```bash
curl http://localhost:8000/healthz
```

Test chat without voice first:

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"大师,我最近有点焦虑,想看看事业运","session_id":"local-demo","with_voice":false}'
```

Then test voice:

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"大师,说一句适合播放的短回复","session_id":"local-demo","with_voice":true}'
```

## 2. Local Mobile/Web

Install dependencies:

```bash
cd /Users/gerry/llm_projects/digital_human/mobile
npm install
cp .env.example .env
```

For Web:

```bash
npm run web
```

For Android native device:

```bash
npm run android:native
```

For a real phone on the same Wi-Fi, set `mobile/.env` to your computer LAN IP:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
```

Then reload the app. If you added or changed native modules, rebuild with `npm run android:native`.

## 3. Upstash Redis

1. Create a Redis database in Upstash.
2. Copy the Redis URL.
3. Use the TLS URL in hosted environments:

```bash
REDIS_URL=rediss://default:password@host.upstash.io:6379
```

The backend uses this for LangChain chat history. Each app chat session maps to a Redis session id.

## 4. Render Backend

Recommended path: use the included `render.yaml`.

1. Push the repo to GitHub.
2. Open Render and create a Blueprint from the repo, or create a Web Service manually.
3. Runtime: Docker.
4. Health check path: `/healthz`.
5. Set `PUBLIC_BASE_URL` to the final Render URL, for example:

```bash
PUBLIC_BASE_URL=https://digital-human-api.onrender.com
```

Render environment variables:

```bash
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
REDIS_URL=rediss://default:password@host.upstash.io:6379
PUBLIC_BASE_URL=https://your-render-service.onrender.com
CORS_ORIGINS=*
```

Voice:

```bash
AZURE_VOICE_KEY=...
AZURE_VOICE_REGION=eastus
```

Tools:

```bash
YUANFENJU_API_KEY=...
SERPAPI_API_KEY=...
```

Optional:

```bash
DEMO_MODE=false
OPENAI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION=local_knowledge
```

Deploy and verify:

```bash
curl https://your-render-service.onrender.com/healthz
```

## 5. Expo Client Against Render

Set mobile API URL:

```bash
cd mobile
cat > .env <<'EOF'
EXPO_PUBLIC_API_BASE_URL=https://your-render-service.onrender.com
EOF
```

Start:

```bash
npm run web
```

or:

```bash
npm run android:native
```

If the app still talks to the old URL, stop Metro and restart it. Expo public env vars are loaded at bundle time.

## 6. Azure Speech Checklist

In Azure Portal:

1. Open the Speech resource.
2. Check **Keys and Endpoint**.
3. Copy Key 1 into `AZURE_VOICE_KEY`.
4. Confirm Location/Region, for example `eastus`, and set:

```bash
AZURE_VOICE_REGION=eastus
```

The backend calls:

```text
https://{AZURE_VOICE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1
```

If TTS fails with 401, the key and region usually do not match.

## 7. Smoke Test Before Interview

Backend:

```bash
curl https://your-render-service.onrender.com/healthz
```

Mobile:

1. Open the app.
2. Send a normal chat message.
3. Confirm streaming output appears.
4. Confirm mood label appears, for example `心情[happy]`.
5. Submit the BaZi form.
6. Confirm structured BaZi content is sent and answered.
7. For tool tag verification, call the Agent-backed `/chat` endpoint or run demo mode and confirm a tag such as `已调用八字测算`.
8. Turn on auto-play voice.
9. Send a short message and confirm voice plays when ready.

## 8. Common Issues

### Docker cannot connect to daemon

Start Docker Desktop first, then run:

```bash
docker compose up -d redis
```

Or skip local Docker and use Upstash Redis.

### Phone cannot reach backend

Use your computer LAN IP, not `localhost`:

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:8000
```

Start Uvicorn with:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Voice file returns 200 but app has no sound

The app uses `expo-audio` and waits until the audio is loaded before playing. Check:

- phone volume
- silent mode / Bluetooth route
- backend logs for `GET /voices/{id}.mp3 200 OK`
- Metro logs for audio playback warnings

### DeepSeek quota or API failure

Set:

```bash
DEMO_MODE=true
```

This keeps the frontend/backend demo path working without external LLM calls.

### Date/time picker native module error

The app uses `@react-native-community/datetimepicker`. Rebuild the native app:

```bash
cd mobile
npm run android:native
```
