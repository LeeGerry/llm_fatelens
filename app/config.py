# URL 地址与常量配置
import os

# Azure TTS
AZURE_TTS_URL = "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"

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

# Telegram Bot
TELEGRAM_START_MSG = "你好,我是陈瞎子,专门算命测八字,请问你想算什么?"

# 语音文件目录
VOICE_OUTPUT_DIR = "voices"

# Telegram 等待音频最大秒数
MAX_AUDIO_WAIT = 60
