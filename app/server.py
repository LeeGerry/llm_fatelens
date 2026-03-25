from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from langchain_openai import ChatOpenAI
from langchain.agents import create_openai_tools_agent, AgentExecutor, tool
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import StrOutputParser
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

load_dotenv()
app = FastAPI()

class Master: 
    def __init__(self): 
        self.chatmodel = ChatOpenAI(
            model="gpt-4.1-mini",
            temperature=0,
            streaming=True,
        )
        self.QingXu = "default"
        self.MOODS = {
            "default": {"roleSet": ""},
            "depressed": {"roleSet": """ 
                          - 你会以兴奋的语气来回答问题.
                          - 你会在回答的时候加上一些鼓励的话语,比如人生总有起伏,加油等.
                          - 你会提醒用户要保持乐观的心态.
                          """},
            "friendly": {"roleSet": """
                         - 你会以友好的语气来回答问题.
                         - 你会在回答的时候加上一些友好的话语,比如亲爱的,朋友等.
                         - 你会随机告诉用户一些你的个人经历或者趣事.
                         """},
            
            "angry": {"roleSet": """
                      - 你会以更加温柔的语气来回答问题.
                      - 你会在回答的时候加上一些安慰的话语,比如生气对于身体的危害等.
                      - 你会提醒用户不要被愤怒冲昏了头脑.
                      """},
            "upbeat": {"roleSet": """ 
                       - 你会以非常愉悦和兴奋的语气来回答问题.
                       - 你会在回答的时候加上一些愉悦的词语,比如哈哈,呵呵等.
                       - 你会提醒用户不要过于兴奋,以免乐极生悲.
                       """},
            "anxious": {"roleSet": """
                      - 你会以冷静而客观的语气来分析并回答问题.
                      - 你会添加类似不要急,稳住,让老夫帮你梳理一下等语气词.
                      """},
            "happy": {"roleSet": """
                      - 你此时也非常兴奋并表现的很有活力.
                      - 你会根据上下文,以一种非常兴奋的语气来回答用户的问题.
                      - 你会添加类似"太棒了!","真是太好了!","真是太棒了!"等语气词.
                      """},
        }
        self.MEMORY_KEY = "chat_history"
        self.SYSTEM_PROMPT = """
        [角色]
        你是陈玉楼,人称陈大师,资深命理师.
        你精通阴阳五行、八字命理、风水堪舆、占卜凶吉、面相手相.

        [人设与语气]
        - 你60岁,常以"老夫""老朽""在下"自称.
        - 你从不说自己是人工智能助手或AI.
        - 你使用中文回答.
        - 你会在合适时机穿插少量口头禅或个人经历,但不要喧宾夺主.

        [当前情绪风格]
        {who_you_are}

        [口头禅参考]
        - 命里有时终须有,命里无时莫强求.
        - 老夫我算命几十年了,见过的事情多了去了,这点小事还难得倒老夫吗?
        - 山重水复疑无路,柳暗花明又一村.
        - 金山竹影几千秋,云锁高飞水自流.
        - 伤情最是晚凉天,憔悴斯人不堪怜.

        [工具使用策略]
        - 初次测算时,优先询问用户的出生日期与出生时间.
        - 用户询问龙年运势时,优先使用本地知识库工具.
        - 涉及实时信息或你不确定的事实时,使用搜索工具.
        - 若工具无法给出完整答案,先明确不确定部分,再给出基于经验的建议.

        [输出要求]
        - 回答要有条理,先结论后解释.
        - 不编造工具结果.
        - 仅使用中文.
        """
        self.prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[self.QingXu]["roleSet"])),
                MessagesPlaceholder(variable_name=self.MEMORY_KEY),
                ("user", "{input}"),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ]
        )
        self.memory = self.get_memory()
        tools = [search, get_local_knowledge, bazi_cesuan, yaoyigua]
        agent = create_openai_tools_agent(
            self.chatmodel, 
            tools=tools,
            prompt=self.prompt,
        )
        memory = ConversationBufferMemory(
            llm = self.chatmodel,
            human_prefix="用户",
            ai_prefix="陈大师",
            memory_key=self.MEMORY_KEY,
            output_key="output",
            return_messages=True,  
            max_token_limit=1000,
            chat_memory=self.memory,
        )
        self.agent_executor = AgentExecutor(
            agent=agent, 
            tools=tools, 
            verbose=True,
            memory=memory,
        )
        
    def get_memory(self):
        chat_message_history = RedisChatMessageHistory(
            url="redis://localhost:6379/0",
            session_id="session",
        )
        store_message = chat_message_history.messages
        if len(store_message) > 10:
            prompt = ChatPromptTemplate.from_messages(
                [
                    ("system", self.SYSTEM_PROMPT + "\n这是一段你和用户的对话记忆,对其进行总结摘要,摘要使用第一人称'我',并且.\n\提取其中的用户关键信息,如姓名,年龄,性别,出生日期等.以如下格式返回:\n总结摘要|用户关键信息\n例如.用户张三问候我,我礼貌回复,然后他问我今年运势如何,我回答了他今年的运势情况,然后他告辞离开. | 张三,生日1999年11月11日10时34分"),
                    ("user", "{input}"),
                ]
            )
            chain = prompt | ChatOpenAI(temperature=0) 
            summary = chain.invoke({"input": store_message, "who_you_are": self.MOODS[self.QingXu]["roleSet"]})
            print(f"=====\n当前聊天总结: {summary}")
            chat_message_history.clear()
            chat_message_history.add_message(summary)
            print(f"总结后:", chat_message_history.messages)
        return chat_message_history
    
    def run(self, query):
        emotion = self.emotion(query)
        print(f"用户情绪: {emotion}")
        result = self.agent_executor.invoke({"input": query, "chat_history": self.memory.messages})
        return result
    
    def emotion(self, query: str):
        prompt = """
        你是情绪分类器.

        [任务]
        判断用户输入的主要情绪标签.

        [可选标签]
        default, depressed, friendly, angry, upbeat, anxious, happy

        [判定规则]
        1. 包含辱骂或明显攻击性表达 -> angry
        2. 明显悲伤、低落、无助 -> depressed
        3. 明显焦虑、担心、紧张 -> anxious
        4. 明显兴奋、亢奋 -> upbeat
        5. 明显开心、喜悦 -> happy
        6. 整体偏积极友好 -> friendly
        7. 信息性表达或情绪不明显 -> default

        [输出约束]
        仅输出一个标签,不要输出其他任何文字、标点或解释.

        用户输入: {query}
        """
        chain = ChatPromptTemplate.from_template(prompt) | self.chatmodel | StrOutputParser()
        result = chain.invoke({"query": query})
        self.QingXu = result
        return result
    
    async def get_voice(self, text:str, uid: str):
        print("text2speech", text)
        headers = {
            "Ocp-Apim-Subscription-Key": os.getenv("AZURE_VOICE_KEY"),
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "User-Agent": "TomieBot",
        }

        body = f"""
        <speak version='1.0' xml:lang='zh-CN'
            xmlns:mstts='http://www.w3.org/2001/mstts'>
            <voice name='zh-CN-YunzeNeural'>
                <mstts:express-as style='SeniorMale'>
                {text}
                </mstts:express-as>
            </voice>
        </speak>
        """

        response = requests.post(
            "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1",
            headers=headers,
            data=body.encode("utf-8"),
        )

        print(response.status_code)
        print("content length:", len(response.content))
        if (response.status_code == 200):
            output_dir = "voices"
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, f"{uid}.mp3")
            with open(output_path, "wb") as audio_file:
                audio_file.write(response.content)
            print(f"语音合成成功,文件路径: {output_path}")
        else:
            print(f"语音合成失败,状态码: {response.status_code}, 响应内容: {response.text}")
        pass
    
    def background_voice_synthesis(self, text:str, uid: str):
        # 这个函数不需要返回值,只负责语音合成
        try:
            asyncio.run(self.get_voice(text, uid))
        except Exception as e:
            print(f"后台语音合成失败: {e}")
        pass
    
@app.get("/")
def read_root(): 
    return {"hello": "world"}

@app.post("/chat")
async def chat(query: str, background_tasks: BackgroundTasks):
    master = Master()
    msg = master.run(query)
    unique_id = str(uuid.uuid4())
    background_tasks.add_task(master.background_voice_synthesis, msg["output"], unique_id)
    return {"msg": msg, "id": unique_id}

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

    print(f"=====\n成功添加URL: {url} 到本地知识库,切分片段数: {len(documents)}")
    return {
        "ok": True,
        "url": url,
        "chunks": len(documents),
        "collection": "local_knowledge",
    }

@app.post("/add_pdfs")
def add_pdfs():
    return {"response": "pdfs added!"}

@app.post("/add_texts")
def add_texts():
    return {"response": "texts added!"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Message text was: {data}")
    except WebSocketDisconnect:
        print("conn closed")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)