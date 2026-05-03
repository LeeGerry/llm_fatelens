import asyncio
import logging

from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.memory import ConversationBufferMemory
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from ..config import DEMO_MODE, PUBLIC_BASE_URL
from ..llm import get_chat_model
from ..prompts import EMOTION_PROMPT, MOODS, SYSTEM_PROMPT
from ..tools import bazi_cesuan, get_local_knowledge, search, yaoyigua
from .memory import get_memory
from .voice import background_voice_synthesis

logger = logging.getLogger(__name__)


class ToolUsageTracker(BaseCallbackHandler):
    def __init__(self):
        self.tools_used: list[str] = []

    def on_tool_start(self, serialized, input_str, **kwargs):
        name = serialized.get("name") if isinstance(serialized, dict) else None
        if name and name not in self.tools_used:
            self.tools_used.append(name)


class Master:
    def __init__(self):
        self.chatmodel = get_chat_model(temperature=0, streaming=True)
        self.MOODS = MOODS
        self.MEMORY_KEY = "chat_history"
        self.SYSTEM_PROMPT = SYSTEM_PROMPT
        self.tools = [search, get_local_knowledge, bazi_cesuan, yaoyigua]

    def run(self, query, session_id: str = "default"):
        if DEMO_MODE:
            result = self.demo_response(query)
            return result, self.demo_mood(query), result.get("tools_used", [])

        mood = self.emotion(query)
        logger.info("用户情绪: %s", mood)
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[mood]["roleSet"])),
                MessagesPlaceholder(variable_name=self.MEMORY_KEY),
                ("user", "{input}"),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ]
        )
        memory_history = get_memory(session_id)
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
        tracker = ToolUsageTracker()
        agent_executor = AgentExecutor(agent=agent, tools=self.tools, verbose=True, memory=memory)
        result = agent_executor.invoke({"input": query}, config={"callbacks": [tracker]})
        result["tools_used"] = tracker.tools_used
        return result, mood, tracker.tools_used

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
        tools_used: list[str] = []
        if "八字" in query or "出生" in query:
            output = (
                "老夫先按面试演示模式给你推一段:若要细看八字,需姓名、性别、出生年月日时,"
                "最好再有出生城市。你这句话里已有部分信息,正式模式下我会调用八字工具抽取参数并测算。"
            )
            tools_used = ["bazi_cesuan"]
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

        return {"output": output, "demo_mode": True, "mood": mood, "tools_used": tools_used}

    def emotion(self, query: str):
        chain = ChatPromptTemplate.from_template(EMOTION_PROMPT) | self.chatmodel | StrOutputParser()
        result = chain.invoke({"query": query}).strip()
        if result not in self.MOODS:
            logger.warning("情绪分类结果非法,回退 default: %s", result)
            return "default"
        return result

    async def stream_direct_reply(
        self,
        query: str,
        session_id: str,
        message_id: str,
        with_voice: bool = True,
    ):
        if DEMO_MODE:
            msg = self.demo_response(query)
            mood = self.demo_mood(query)
            yield {"type": "start", "message_id": message_id, "mood": mood, "tools_used": msg["tools_used"]}
            for index in range(0, len(msg["output"]), 4):
                yield {"type": "delta", "text": msg["output"][index:index + 4]}
                await asyncio.sleep(0.03)
            yield {
                "type": "done",
                "message_id": message_id,
                "mood": mood,
                "audio_url": f"{PUBLIC_BASE_URL}/voices/{message_id}.mp3" if with_voice else None,
                "audio_status_url": f"{PUBLIC_BASE_URL}/audio/{message_id}/status" if with_voice else None,
                "tools_used": msg["tools_used"],
            }
            if with_voice:
                asyncio.create_task(asyncio.to_thread(background_voice_synthesis, msg["output"], message_id, mood))
            return

        mood = self.emotion(query)
        yield {"type": "start", "message_id": message_id, "mood": mood, "tools_used": []}
        memory_history = get_memory(session_id)
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", self.SYSTEM_PROMPT.format(who_you_are=self.MOODS[mood]["roleSet"])),
                MessagesPlaceholder(variable_name=self.MEMORY_KEY),
                ("user", "{input}"),
            ]
        )
        chain = prompt | get_chat_model(temperature=0, streaming=True)

        full_text = ""
        async for chunk in chain.astream({"input": query, self.MEMORY_KEY: memory_history.messages}):
            text = getattr(chunk, "content", "")
            if not text:
                continue
            full_text += text
            yield {"type": "delta", "text": text}

        memory_history.add_user_message(query)
        memory_history.add_ai_message(full_text)
        yield {
            "type": "done",
            "message_id": message_id,
            "mood": mood,
            "audio_url": f"{PUBLIC_BASE_URL}/voices/{message_id}.mp3" if with_voice else None,
            "audio_status_url": f"{PUBLIC_BASE_URL}/audio/{message_id}/status" if with_voice else None,
            "tools_used": [],
        }
        if with_voice:
            asyncio.create_task(asyncio.to_thread(background_voice_synthesis, full_text, message_id, mood))
