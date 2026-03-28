import requests
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from langchain_openai import ChatOpenAI
from langchain.agents import create_openai_tools_agent, AgentExecutor, tool
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_community.utilities import SerpAPIWrapper
from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient
from qdrant_client import models
from langchain_community.chat_message_histories import RedisChatMessageHistory
from langchain_openai import OpenAIEmbeddings
from dotenv import load_dotenv
from MyTools import *
from langchain.memory import ConversationBufferMemory
from langchain_community.document_loaders import WebBaseLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os
import asyncio
import uuid
from prompts import SYSTEM_PROMPT, MOODS, EMOTION_PROMPT, MEMORY_SUMMARY_PROMPT
from config import AZURE_TTS_URL, SSML_TEMPLATE, VOICE_OUTPUT_DIR

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)
app = FastAPI()

class Master:
    def __init__(self):
        self.chatmodel = ChatOpenAI(
            model="gpt-4.1-mini",
            temperature=0,
            streaming=True,
        )
        self.QingXu = "default"
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
            chain = prompt | ChatOpenAI(temperature=0)
            summary = chain.invoke({"input": store_message})
            logger.info(f"当前聊天总结: {summary}")
            chat_message_history.clear()
            chat_message_history.add_message(summary)
            logger.info(f"总结后: {chat_message_history.messages}")
        return chat_message_history

    def run(self, query, session_id: str = "default"):
        self.emotion(query)
        logger.info(f"用户情绪: {self.QingXu}")

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[self.QingXu]["roleSet"])),
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
        return result

    def emotion(self, query: str):
        chain = ChatPromptTemplate.from_template(EMOTION_PROMPT) | self.chatmodel | StrOutputParser()
        result = chain.invoke({"query": query})
        self.QingXu = result
        return result

    async def get_voice(self, text: str, uid: str):
        logger.info(f"text2speech: {text}")
        headers = {
            "Ocp-Apim-Subscription-Key": os.getenv("AZURE_VOICE_KEY"),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "TomieBot",
        }

        body = SSML_TEMPLATE.format(
            voice_style=self.MOODS[self.QingXu]["voiceStyle"],
            text=text,
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

    def background_voice_synthesis(self, text: str, uid: str):
        try:
            asyncio.run(self.get_voice(text, uid))
        except Exception as e:
            logger.error(f"后台语音合成失败: {e}")


master = Master()


@app.get("/")
def read_root():
    return {"hello": "world"}

@app.post("/chat")
async def chat(query: str, session_id: str = "default", background_tasks: BackgroundTasks = None):
    msg = master.run(query, session_id)
    unique_id = str(uuid.uuid4())
    background_tasks.add_task(master.background_voice_synthesis, msg["output"], unique_id)
    return {"msg": msg, "id": unique_id, "voice": f"{unique_id}.mp3"}

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
    qdrant_client = QdrantClient(path="./local_qdrant")

    try:
        qdrant_client.get_collection(collection_name="local_knowledge")
    except Exception:
        vector_size = len(embeddings.embed_query("vector_size_probe"))
        qdrant_client.create_collection(
            collection_name="local_knowledge",
            vectors_config=models.VectorParams(
                size=vector_size,
                distance=models.Distance.COSINE,
            ),
        )

    vectorstore = Qdrant(
        client=qdrant_client,
        collection_name="local_knowledge",
        embeddings=embeddings,
    )
    vectorstore.add_documents(documents)

    logger.info(f"成功添加URL: {url} 到本地知识库,切分片段数: {len(documents)}")
    return {
        "ok": True,
        "url": url,
        "chunks": len(documents),
        "collection": "local_knowledge",
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
