import asyncio
import json
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from langchain_community.document_loaders import WebBaseLoader
from langchain_community.vectorstores import Qdrant
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from qdrant_client import QdrantClient, models

from .config import (
    CORS_ORIGINS,
    PUBLIC_BASE_URL,
    QDRANT_API_KEY,
    QDRANT_COLLECTION,
    QDRANT_PATH,
    QDRANT_URL,
    VOICE_OUTPUT_DIR,
)
from .errors import error_payload
from .prompts import MOODS
from .schemas import AudioRetryRequest, AudioStatusResponse, ChatRequest, ChatResponse
from .services.master import Master
from .services.voice import background_voice_synthesis, get_audio_job, set_audio_status
from .startup import cleanup_old_voice_files, validate_runtime_config

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Digital Human Fortune API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

master = Master()
stream_queues: dict[str, asyncio.Queue] = {}


@app.on_event("startup")
async def on_startup():
    validate_runtime_config()
    cleanup_old_voice_files(max_age_hours=24)


async def enqueue_stream_events(
    stream_id: str,
    query: str,
    session_id: str,
    message_id: str,
    with_voice: bool,
):
    queue = stream_queues.get(stream_id)
    if queue is None:
        return

    try:
        async for event in master.stream_direct_reply(query, session_id, message_id, with_voice):
            await queue.put(event)
    except Exception as e:
        logger.exception("SSE 聊天任务失败: %s", e)
        await queue.put(
            {
                "type": "error",
                "message_id": message_id,
                "mood": "default",
                "text": "老夫这边的流式测算刚刚岔了一下气,请稍后再试。",
                "error": error_payload("STREAM_FAILED", "流式聊天请求失败"),
            }
        )


@app.get("/")
def read_root():
    return {"name": "Digital Human Fortune API", "ok": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, background_tasks: BackgroundTasks):
    try:
        msg, mood, tools_used = await run_in_threadpool(master.run, request.message, request.session_id)
    except Exception as e:
        logger.exception("聊天请求失败: %s", e)
        return ChatResponse(
            reply=(
                "老夫这边的测算服务刚刚岔了一下气。若你已经提供姓名和出生年月日时,"
                "老夫可以先按一般命理经验为你分析;若要调用精确八字接口,请稍后再试。"
            ),
            session_id=request.session_id,
            message_id=str(uuid.uuid4()),
            mood="default",
            tools_used=[],
            raw=error_payload("CHAT_FAILED", str(e)),
        )

    unique_id = str(uuid.uuid4())
    audio_url = None
    audio_status_url = None
    if request.with_voice:
        set_audio_status(unique_id, "pending")
        background_tasks.add_task(background_voice_synthesis, msg["output"], unique_id, mood)
        audio_url = f"{PUBLIC_BASE_URL}/voices/{unique_id}.mp3"
        audio_status_url = f"{PUBLIC_BASE_URL}/audio/{unique_id}/status"

    return ChatResponse(
        reply=msg["output"],
        session_id=request.session_id,
        message_id=unique_id,
        mood=mood,
        audio_url=audio_url,
        audio_status_url=audio_status_url,
        tools_used=tools_used,
        raw=msg,
    )


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    message_id = str(uuid.uuid4())

    async def event_stream():
        try:
            async for event in master.stream_direct_reply(
                request.message,
                request.session_id,
                message_id,
                request.with_voice,
            ):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as e:
            logger.exception("流式聊天请求失败: %s", e)
            yield json.dumps(
                {
                    "type": "error",
                    "message_id": message_id,
                    "mood": "default",
                    "text": "老夫这边的流式测算刚刚岔了一下气,请稍后再试。",
                    "error": error_payload("STREAM_FAILED", "流式聊天请求失败"),
                },
                ensure_ascii=False,
            ) + "\n"

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/chat/stream/start")
async def chat_stream_start(request: ChatRequest):
    stream_id = str(uuid.uuid4())
    message_id = str(uuid.uuid4())
    stream_queues[stream_id] = asyncio.Queue()
    asyncio.create_task(
        enqueue_stream_events(
            stream_id,
            request.message,
            request.session_id,
            message_id,
            request.with_voice,
        )
    )
    return {"stream_id": stream_id, "message_id": message_id}


@app.get("/chat/stream/{stream_id}/events")
async def chat_stream_events(stream_id: str):
    queue = stream_queues.get(stream_id)
    if queue is None:
        raise HTTPException(status_code=404, detail=error_payload("STREAM_NOT_FOUND", "stream not found"))

    async def event_stream():
        try:
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in {"done", "error"}:
                    break
        finally:
            stream_queues.pop(stream_id, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/chat_legacy")
async def chat_legacy(
    background_tasks: BackgroundTasks,
    query: str = Query(...),
    session_id: str = Query(default="default"),
):
    request = ChatRequest(message=query, session_id=session_id, with_voice=True)
    response = await chat(request, background_tasks)
    return {
        "msg": {"output": response.reply},
        "id": response.message_id,
        "voice": f"{response.message_id}.mp3",
        "mood": response.mood,
    }


@app.get("/voices/{filename}")
def get_voice_file(filename: str):
    if not filename.endswith(".mp3") or "/" in filename:
        raise HTTPException(status_code=400, detail=error_payload("INVALID_AUDIO_ID", "invalid filename"))

    path = os.path.join(VOICE_OUTPUT_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=error_payload("VOICE_NOT_READY", "voice not ready"))

    return FileResponse(path, media_type="audio/mpeg", filename=filename)


@app.get("/audio/{audio_id}/status", response_model=AudioStatusResponse)
def get_audio_status(audio_id: str):
    filename = f"{audio_id}.mp3"
    path = os.path.join(VOICE_OUTPUT_DIR, filename)
    if os.path.exists(path):
        set_audio_status(audio_id, "ready")
        return AudioStatusResponse(
            id=audio_id,
            status="ready",
            audio_url=f"{PUBLIC_BASE_URL}/voices/{filename}",
        )
    job = get_audio_job(audio_id)
    if job:
        return AudioStatusResponse(
            id=audio_id,
            status=job.get("status", "pending"),
            error=job.get("error"),
        )
    return AudioStatusResponse(id=audio_id, status="pending")


@app.post("/audio/{audio_id}/retry", response_model=AudioStatusResponse)
async def retry_audio(audio_id: str, request: AudioRetryRequest, background_tasks: BackgroundTasks):
    if "/" in audio_id or audio_id.endswith(".mp3"):
        raise HTTPException(status_code=400, detail=error_payload("INVALID_AUDIO_ID", "invalid audio id"))

    mood = request.mood if request.mood in MOODS else "default"
    set_audio_status(audio_id, "pending")
    background_tasks.add_task(background_voice_synthesis, request.text, audio_id, mood)
    return AudioStatusResponse(id=audio_id, status="pending")


@app.post("/add_urls")
def add_urls(url: str):
    loader = WebBaseLoader(url)
    docs = loader.load()
    if not docs:
        return error_payload("NO_WEB_CONTENT", "未抓取到网页内容")

    documents = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100,
    ).split_documents(docs)
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
    if QDRANT_URL:
        qdrant_client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
    else:
        qdrant_client = QdrantClient(path=QDRANT_PATH)

    try:
        qdrant_client.get_collection(collection_name=QDRANT_COLLECTION)
    except Exception:
        vector_size = len(embeddings.embed_query("vector_size_probe"))
        qdrant_client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=models.VectorParams(
                size=vector_size,
                distance=models.Distance.COSINE,
            ),
        )

    vectorstore = Qdrant(
        client=qdrant_client,
        collection_name=QDRANT_COLLECTION,
        embeddings=embeddings,
    )
    vectorstore.add_documents(documents)
    logger.info("成功添加URL: %s 到本地知识库,切分片段数: %s", url, len(documents))
    return {
        "ok": True,
        "url": url,
        "chunks": len(documents),
        "collection": QDRANT_COLLECTION,
    }


@app.post("/add_pdfs")
def add_pdfs():
    return error_payload("NOT_IMPLEMENTED", "未实现")


@app.post("/add_texts")
def add_texts():
    return error_payload("NOT_IMPLEMENTED", "未实现")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Message text was: {data}")
    except WebSocketDisconnect:
        logger.info("WebSocket 连接关闭")
