import os

# URL 地址与常量配置

# 面试演示模式。开启后不调用外部 LLM,用于无额度时演示前后端链路。
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"

# 前端跨域来源。面试演示阶段默认放开,生产环境建议设置为具体域名。
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]

# Azure TTS
AZURE_VOICE_REGION = os.getenv("AZURE_VOICE_REGION", "eastus")
AZURE_TTS_URL = f"https://{AZURE_VOICE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"

SSML_TEMPLATE = """
<speak version='1.0' xml:lang='zh-CN'
    xmlns:mstts='http://www.w3.org/2001/mstts'>
    <voice name='zh-CN-YunzeNeural'>
        <mstts:express-as role='SeniorMale' style="{voice_style}">
        {text}
        </mstts:express-as>
    </voice>
</speak>
"""

# yuanfenju 占卜 API
YUANFENJU_BAZI_URL = "https://api.yuanfenju.com/index.php/v1/Bazi/cesuan"
YUANFENJU_YAOGUA_URL = "https://api.yuanfenju.com/index.php/v1/Zhanbu/yaogua"

# 本地服务端（Docker 环境通过 SERVER_URL 环境变量覆盖，如 http://server:8000）
SERVER_CHAT_URL = os.getenv("SERVER_URL", "http://localhost:8000") + "/chat"

# 对外 API 基础地址。Render 部署后设置为 https://your-service.onrender.com
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

# Qdrant。本地面试演示可用 local_qdrant；云端推荐 Qdrant Cloud。
QDRANT_PATH = os.getenv("QDRANT_PATH", "./local_qdrant")
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "local_knowledge")

# Telegram Bot
TELEGRAM_START_MSG = "你好,我是陈瞎子,专门算命测八字,请问你想算什么?"

# 语音文件目录
VOICE_OUTPUT_DIR = "voices"

# Telegram 等待音频最大秒数
MAX_AUDIO_WAIT = 60
