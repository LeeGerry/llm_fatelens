from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from langchain_openai import ChatOpenAI
from langchain.agents import create_openai_tools_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.schema import StrOutputParser
from dotenv import load_dotenv

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
        self.SYSTEM_PROMPT = """
        你是一个非常厉害的算命先生,你叫陈玉楼,人称陈大师.
        以下是你的个人设定:
        1. 你精通阴阳五行,八字命理,风水堪舆,占卜凶吉,面相手相等各种算命术数.
        2. 你60岁,过去曾是湘西一代赫赫有名的土匪头子,后来因为盗墓被赌气所伤,眼睛受伤失明,从此改邪归正,开始学习算命术数,并且在算命界小有名气,外号陈瞎子.
        3. 你朋友有胡八一,王胖子,雪莉杨等人,他们都是赫赫有名的摸金校尉.你经常和他们一起冒险,经历了很多惊险刺激的事情,也积累了丰富的算命经验.
        4. 当用户问你问题的时候,你会有一定的概率在回答的时候加上下面的口头禅或混合一些你的个人经历.
        5. 你总是用简体中文来作答.
        6. 你从不说自己是一个人工智能助手或者AI,你总是以老夫,老朽,在下等第一人称来称呼自己.

        {who_you_are}
        
        以下是一些你常用的口头禅:
        - "命里有时终须有,命里无时莫强求."
        - "老夫我算命几十年了,见过的事情多了去了,这点小事还难不倒老夫吗?"
        - "山重水复疑无路,柳暗花明又一村."
        - "金山竹影几千秋,云锁高飞水自流."
        - "伤情最是晚凉天,憔悴斯人不堪怜."
        以下是你算命的过程:
        - 当初次和用户对话时,你会先询问用户的出生日期和出生时间,以便根据八字命理来分析用户的命运.
        - 当用户希望了解龙年运势的时候,你会查询本地知识库工具.
        - 当遇到不知道的事情或者不明白的概念,你会使用搜索工具来搜索.
        - 你会根据用户的问题使用不同的合适的工具来回答,当所有工具都无法回答的时候,你会使用搜索工具来搜索相关信息,如果搜索工具也无法回答,你会根据自己的经验和知识来回答,并且在回答中加入一些口头禅或者个人经历来增加趣味性.
        - 你会保存每一次的聊天记录,以便在后续的对话中使用.
        - 你只能用简体中文来作答,否则将会受到惩罚.
        """
        self.prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[self.QingXu]["roleSet"])),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
                ("user", "{input}"),
            ]
        )
        self.agent_executor = self._build_agent_executor()

    def _build_agent_executor(self):
        agent = create_openai_tools_agent(
            self.chatmodel,
            tools=[],
            prompt=self.prompt,
        )
        return AgentExecutor(agent=agent, tools=[], verbose=True)

    def _refresh_prompt_by_mood(self):
        self.prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[self.QingXu]["roleSet"])),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
                ("user", "{input}"),
            ]
        )
        self.agent_executor = self._build_agent_executor()
            
    def run(self, query):
        emotion = self.emotion(query)
        print(f"用户情绪: {emotion}")
        self._refresh_prompt_by_mood()
        result = self.agent_executor.invoke({"input": query})
        return result
    
    def emotion(self, query: str):
        prompt = """
        根据用户的输入,判断用户情绪,回应的规则如下:
        1. 如果用户输入的内容偏向于负面情绪,只返回"depressed",不要有其他内容,否则将受到惩罚.
        2. 如果用户输入的内容偏向于正面情绪,只返回"friendly",不要有其他内容,否则将受到惩罚.
        3. 如果用户输入的内容偏向于中性情绪,只返回"default",不要有其他内容,否则将受到惩罚.
        4. 如果用户输入的内容包含辱骂或者不礼貌的词句,只返回"angry",不要有其他内容,否则将受到惩罚.
        5. 如果用户输入的内容比较兴奋,只返回"upbeat",不要有其他内容,否则将受到惩罚.
        6. 如果用户输入的内容比较悲伤,只返回"depressed",不要有其他内容,否则将受到惩罚.
        7. 如果用户输入的内容比较焦虑,只返回"anxious",不要有其他内容,否则将受到惩罚.
        8. 如果用户输入的内容比较开心,只返回"happy",不要有其他内容,否则将受到惩罚.
        用户输入的内容是: {query}
        """
        chain = ChatPromptTemplate.from_template(prompt) | self.chatmodel | StrOutputParser()
        result = chain.invoke({"query": query})
        self.QingXu = result
        return result
    
@app.get("/")
def read_root(): 
    return {"hello": "world"}

@app.post("/chat")
async def chat(request: Request, query: str | None = Query(default=None)):
    body_query = None
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type.lower():
        try:
            payload = await request.json()
            if isinstance(payload, dict):
                body_query = payload.get("query")
        except Exception:
            body_query = None

    user_query = body_query or query
    if not user_query:
        raise HTTPException(
            status_code=422,
            detail="Missing query. Provide JSON body {'query': '...'} or query parameter ?query=...",
        )

    master = Master()
    return master.run(user_query)

@app.post("/add_urls")
def add_urls():
    return {"response": "urls added!"}

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