import logging
import os

from langchain_core.prompts import ChatPromptTemplate
from langchain_community.chat_message_histories import RedisChatMessageHistory

from ..llm import get_chat_model
from ..prompts import MEMORY_SUMMARY_PROMPT, SYSTEM_PROMPT

logger = logging.getLogger(__name__)


def get_memory(session_id: str = "default"):
    chat_message_history = RedisChatMessageHistory(
        url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        session_id=session_id,
    )
    store_message = chat_message_history.messages
    if len(store_message) > 10:
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT.format(who_you_are="") + MEMORY_SUMMARY_PROMPT),
                ("user", "{input}"),
            ]
        )
        chain = prompt | get_chat_model(temperature=0)
        summary = chain.invoke({"input": store_message})
        logger.info("当前聊天总结: %s", summary)
        chat_message_history.clear()
        chat_message_history.add_message(summary)
        logger.info("总结后: %s", chat_message_history.messages)
    return chat_message_history
