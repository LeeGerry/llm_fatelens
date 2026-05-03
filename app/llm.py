import os

from langchain_openai import ChatOpenAI


def get_chat_model(temperature: float = 0, streaming: bool = False):
    provider = os.getenv("LLM_PROVIDER", "deepseek").lower()

    if provider == "openai":
        return ChatOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            temperature=temperature,
            streaming=streaming,
        )

    return ChatOpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        temperature=temperature,
        streaming=streaming,
    )
