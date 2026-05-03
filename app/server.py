import html
import logging
import os
import re
import uuid

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient
from qdrant_client import models
from langchain_community.chat_message_histories import RedisChatMessageHistory
from langchain_openai import OpenAIEmbeddings
from dotenv import load_dotenv
from langchain.memory import ConversationBufferMemory
from langchain_community.document_loaders import WebBaseLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import asyncio

try:
    from .MyTools import bazi_cesuan, get_local_knowledge, search, yaoyigua
    from .config import (
        AZURE_TTS_URL,
        CORS_ORIGINS,
        DEMO_MODE,
        PUBLIC_BASE_URL,
        QDRANT_API_KEY,
        QDRANT_COLLECTION,
        QDRANT_PATH,
        QDRANT_URL,
        SSML_TEMPLATE,
        VOICE_OUTPUT_DIR,
    )
    from .llm import get_chat_model
    from .prompts import EMOTION_PROMPT, MEMORY_SUMMARY_PROMPT, MOODS, SYSTEM_PROMPT
    from .schemas import AudioStatusResponse, ChatRequest, ChatResponse
except ImportError:
    from MyTools import bazi_cesuan, get_local_knowledge, search, yaoyigua
    from config import (
        AZURE_TTS_URL,
        CORS_ORIGINS,
        DEMO_MODE,
        PUBLIC_BASE_URL,
        QDRANT_API_KEY,
        QDRANT_COLLECTION,
        QDRANT_PATH,
        QDRANT_URL,
        SSML_TEMPLATE,
        VOICE_OUTPUT_DIR,
    )
    from llm import get_chat_model
    from prompts import EMOTION_PROMPT, MEMORY_SUMMARY_PROMPT, MOODS, SYSTEM_PROMPT
    from schemas import AudioStatusResponse, ChatRequest, ChatResponse

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)
app = FastAPI(title="Digital Human Fortune API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def sanitize_text_for_tts(text: str) -> str:
    cleaned = text
    cleaned = re.sub(r"```[\s\S]*?```", " ", cleaned)
    cleaned = re.sub(r"`([^`]*)`", r"\1", cleaned)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"[*_~>#|]", "", cleaned)
    cleaned = re.sub(r"-{3,}", "。", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


class Master:
    def __init__(self):
        self.chatmodel = get_chat_model(temperature=0, streaming=True)
        self.MOODS = MOODS
        self.MEMORY_KEY = "chat_history"
        self.SYSTEM_PROMPT = SYSTEM_PROMPT
        self.tools = [search, get_local_knowledge, bazi_cesuan, yaoyigua]

    def get_memory(self, session_id: str = "default"):
        chat_message_history = RedisChatMessageHistory(
            url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
            session_id=session_id,
        )
        store_message = chat_message_history.messages
        if len(store_message) > 10:
            prompt = ChatPromptTemplate.from_messages(
                [
                    ("system", self.SYSTEM_PROMPT.format(who_you_are="") + MEMORY_SUMMARY_PROMPT),
                    ("user", "{input}"),
                ]
            )
            chain = prompt | get_chat_model(temperature=0)
            summary = chain.invoke({"input": store_message})
            logger.info(f"当前聊天总结: {summary}")
            chat_message_history.clear()
            chat_message_history.add_message(summary)
            logger.info(f"总结后: {chat_message_history.messages}")
        return chat_message_history

    def run(self, query, session_id: str = "default"):
        if DEMO_MODE:
            return self.demo_response(query), self.demo_mood(query)

        mood = self.emotion(query)
        logger.info(f"用户情绪: {mood}")

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[mood]["roleSet"])),
                MessagesPlaceholder(variable_name=self.MEMORY_KEY),
                ("user", "{input}"),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ]
        )
        memory_history = self.get_memory(session_id)
        agent = create_openai_tools_agent(self.chatmodel, tools=self.tools, prompt=prompt)
        memory = ConversationBufferMemory(
            llm=self.chatmodel,
            human_prefix="用户",
            ai_prefix="陈大师",
            memory_key=self.MEMORY_KEY,
            output_key="output",
            return_messages=True,
            max_token_limit=1000,
            chat_memory=memory_history,
        )
        agent_executor = AgentExecutor(agent=agent, tools=self.tools, verbose=True, memory=memory)
        result = agent_executor.invoke({"input": query})
        return result, mood

    def demo_mood(self, query: str):
        if any(word in query for word in ["焦虑", "担心", "紧张", "害怕"]):
            return "anxious"
        if any(word in query for word in ["开心", "高兴", "太好了"]):
            return "happy"
        if any(word in query for word in ["生气", "烦死", "滚"]):
            return "angry"
        return "friendly"

    def demo_response(self, query: str):
        mood = self.demo_mood(query)
        if "八字" in query or "出生" in query:
            output = (
                "老夫先按面试演示模式给你推一段:若要细看八字,需姓名、性别、出生年月日时,"
                "最好再有出生城市。你这句话里已有部分信息,正式模式下我会调用八字工具抽取参数并测算。"
            )
        elif "事业" in query or "工作" in query:
            output = (
                "不要急,稳住。老夫看你此问,事业运眼下重在一个'定'字:先收束方向,"
                "把手头最能产生成果的一件事做深。三个月内宜主动争取展示机会,少被旁枝杂念牵着走。"
            )
        else:
            output = (
                "老夫听明白了。此为演示模式回复:正式模式下,我会结合多轮记忆、工具调用和情绪识别,"
                "给出更贴合上下文的命理分析。"
            )

        return {"output": output, "demo_mode": True, "mood": mood}

    def emotion(self, query: str):
        chain = ChatPromptTemplate.from_template(EMOTION_PROMPT) | self.chatmodel | StrOutputParser()
        result = chain.invoke({"query": query}).strip()
        if result not in self.MOODS:
            logger.warning(f"情绪分类结果非法,回退 default: {result}")
            return "default"
        return result

    async def get_voice(self, text: str, uid: str, mood: str):
        speech_text = sanitize_text_for_tts(text)
        logger.info(f"text2speech: {speech_text}")
        voice_key = os.getenv("AZURE_VOICE_KEY")
        if not voice_key:
            logger.warning("未配置 AZURE_VOICE_KEY,跳过语音合成")
            return
        if not speech_text:
            logger.warning("清洗后 TTS 文本为空,跳过语音合成")
            return

        headers = {
            "Ocp-Apim-Subscription-Key": voice_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "TomieBot",
        }

        body = SSML_TEMPLATE.format(
            voice_style=self.MOODS[mood]["voiceStyle"],
            text=html.escape(speech_text),
        )

        response = requests.post(
            AZURE_TTS_URL,
            headers=headers,
            data=body.encode("utf-8"),
            timeout=15,
        )

        logger.info(f"TTS 状态码: {response.status_code}, 内容长度: {len(response.content)}")
        if response.status_code == 200:
            os.makedirs(VOICE_OUTPUT_DIR, exist_ok=True)
            output_path = os.path.join(VOICE_OUTPUT_DIR, f"{uid}.mp3")
            with open(output_path, "wb") as audio_file:
                audio_file.write(response.content)
            logger.info(f"语音合成成功,文件路径: {output_path}")
        else:
            logger.error(f"语音合成失败,状态码: {response.status_code}, 响应内容: {response.text}")

    def background_voice_synthesis(self, text: str, uid: str, mood: str):
        try:
            asyncio.run(self.get_voice(text, uid, mood))
        except Exception as e:
            logger.error(f"后台语音合成失败: {e}")


master = Master()


@app.get("/")
def read_root():
    return {"name": "Digital Human Fortune API", "ok": True}


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, background_tasks: BackgroundTasks):
    try:
        msg, mood = await run_in_threadpool(master.run, request.message, request.session_id)
    except Exception as e:
        logger.exception(f"聊天请求失败: {e}")
        return ChatResponse(
            reply=(
                "老夫这边的测算服务刚刚岔了一下气。若你已经提供姓名和出生年月日时,"
                "老夫可以先按一般命理经验为你分析;若要调用精确八字接口,请稍后再试。"
            ),
            session_id=request.session_id,
            message_id=str(uuid.uuid4()),
            mood="default",
            raw={"error": str(e)},
        )
    unique_id = str(uuid.uuid4())
    audio_url = None
    audio_status_url = None
    if request.with_voice:
        background_tasks.add_task(master.background_voice_synthesis, msg["output"], unique_id, mood)
        audio_url = f"{PUBLIC_BASE_URL}/voices/{unique_id}.mp3"
        audio_status_url = f"{PUBLIC_BASE_URL}/audio/{unique_id}/status"

    return ChatResponse(
        reply=msg["output"],
        session_id=request.session_id,
        message_id=unique_id,
        mood=mood,
        audio_url=audio_url,
        audio_status_url=audio_status_url,
        raw=msg,
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
        raise HTTPException(status_code=400, detail="invalid filename")

    path = os.path.join(VOICE_OUTPUT_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="voice not ready")

    return FileResponse(path, media_type="audio/mpeg", filename=filename)


@app.get("/audio/{audio_id}/status", response_model=AudioStatusResponse)
def get_audio_status(audio_id: str):
    filename = f"{audio_id}.mp3"
    path = os.path.join(VOICE_OUTPUT_DIR, filename)
    if os.path.exists(path):
        return AudioStatusResponse(
            id=audio_id,
            status="ready",
            audio_url=f"{PUBLIC_BASE_URL}/voices/{filename}",
        )
    return AudioStatusResponse(id=audio_id, status="pending")

@app.post("/add_urls")
def add_urls(url: str):
    loader = WebBaseLoader(url)
    docs = loader.load()
    if not docs:
        return {"ok": False, "message": "未抓取到网页内容"}

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

    logger.info(f"成功添加URL: {url} 到本地知识库,切分片段数: {len(documents)}")
    return {
        "ok": True,
        "url": url,
        "chunks": len(documents),
        "collection": QDRANT_COLLECTION,
    }

@app.post("/add_pdfs")
def add_pdfs():
    return {"error": "未实现"}, 501

@app.post("/add_texts")
def add_texts():
    return {"error": "未实现"}, 501

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Message text was: {data}")
    except WebSocketDisconnect:
        logger.info("WebSocket 连接关闭")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
