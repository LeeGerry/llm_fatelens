import logging
import os
import requests
from langchain_community.utilities import SerpAPIWrapper
from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient
from langchain_openai import OpenAIEmbeddings
from langchain.agents import create_openai_tools_agent, AgentExecutor, tool
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# 模块级单例，避免每次工具调用重新创建
_qdrant_client = QdrantClient(path="./local_qdrant")
_embeddings = OpenAIEmbeddings(model="text-embedding-3-small")

@tool
def get_local_knowledge(query: str):
    """只有当用户想要了解龙年运势,家中的财位,或者水瓶座运势的时候才会使用这个工具."""
    logger.info(f"正在使用本地知识库工具 query: {query}")
    query_vector = _embeddings.embed_query(query)
    response = _qdrant_client.query_points(
        collection_name="local_knowledge",
        query=query_vector,
        limit=4,
        with_payload=True,
    )
    points = response.points
    result = []
    for point in points:
        payload = point.payload or {}
        page_content = payload.get("page_content")
        if page_content:
            result.append(page_content)

    logger.info(f"本地知识库工具返回的结果: {result}")
    return "\n\n".join(result) if result else "本地知识库中没有检索到相关内容"

@tool
def search(query: str):
    """只有需要了解实时信息或不知道的事情的时候才会使用这个工具."""
    logger.info(f"正在使用搜索工具 query: {query}")
    serp_api = SerpAPIWrapper()
    result = serp_api.run(query)
    logger.info(f"搜索工具返回的结果: {result}")
    return result

@tool
def bazi_cesuan(query: str):
    """八字测算工具,这个工具需要输入用户姓名和出生年月日时,如果缺少用户姓名和出生年月日时,则不可用."""
    logger.info(f"正在使用八字测算工具 query: {query}")
    api_key = os.getenv("YUANFENJU_API_KEY", "")
    prompt = ChatPromptTemplate.from_template(
    """
你是一个参数查询助手,根据用户输入内容找出相关的参数并按JSON格式返回.
JSON字段如下:
'api_key': '{api_key}',
'name': '姓名,例如:张三',
'sex': '性别,0表示男,1表示女,根据姓名判断性别',
'type': '日历类型,0农历,1公历,默认1',
'year': '出生年份,例如:1988',
'month': '出生月份,例如:11',
'day': '出生日,例如:8',
'hours': '出生小时,例如:12',
'minute': '出生分钟,例如:20',
'zhen': '出生时辰,例如:1,这个非必须参数',
'province': '出生省份,例如:北京市,这个非必须参数',
'city': '出生城市,例如:北京市,这个非必须参数',
\n
如果没有找到相关参数,则需要提醒用户告诉你这些内容,只返回数据结构,不要有其他的评论.
用户输入的内容是: {{query}}
    """
    )
    parser = JsonOutputParser()
    url = f"https://api.yuanfenju.com/index.php/v1/Bazi/cesuan?api_key={api_key}"
    prompt = prompt.partial(format_instructions=parser.get_format_instructions(), api_key=api_key)
    chain = prompt | ChatOpenAI(temperature=0) | parser
    data = chain.invoke({"query": query})
    logger.info(f"八字测算工具返回的结果: {data}")
    try:
        result = requests.post(url, data=data, timeout=10)
        if result.status_code == 200:
            logger.info(f"八字测算工具接口返回的结果: {result.json()}")
            try:
                resp_data = result.json()
                return resp_data["data"]
            except Exception as e:
                logger.error(f"八字测算工具接口返回的结果无法解析: {e}")
                return "八字测算工具失败,接口返回的结果无法解析"
        else:
            logger.error(f"八字测算工具接口请求失败,状态码: {result.status_code},响应内容: {result.text}")
            return "八字测算工具请求失败"
    except Exception as e:
        logger.error(f"八字测算工具请求异常: {e}")
        return "八字测算工具请求异常"

@tool
def yaoyigua():
    """只有用户想要占卜抽签的时候才会使用这个工具."""
    logger.info("正在使用占卜抽签工具")
    api_key = os.getenv("YUANFENJU_API_KEY", "")
    url = "https://api.yuanfenju.com/index.php/v1/Zhanbu/yaogua"
    try:
        result = requests.post(url, data={"api_key": api_key, "lang": "zh-cn"}, timeout=10)
        if result.status_code == 200:
            logger.info(f"占卜抽签工具接口返回的结果: {result.json()}")
            try:
                resp_data = result.json()
                return resp_data["data"]
            except Exception as e:
                logger.error(f"占卜抽签工具接口返回的结果无法解析: {e}")
                return "占卜抽签工具失败,接口返回的结果无法解析"
        else:
            logger.error(f"占卜抽签工具接口请求失败,状态码: {result.status_code},响应内容: {result.text}")
            return "占卜抽签工具请求失败"
    except Exception as e:
        logger.error(f"占卜抽签工具请求异常: {e}")
        return "占卜抽签工具请求异常"
