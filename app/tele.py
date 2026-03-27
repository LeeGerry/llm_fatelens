import telebot
import requests
import urllib.parse
import json
import os
import asyncio
import logging
from dotenv import load_dotenv
from config import SERVER_CHAT_URL, TELEGRAM_START_MSG, MAX_AUDIO_WAIT, VOICE_OUTPUT_DIR

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

bot = telebot.TeleBot(os.getenv('TELEGRAM_BOT_TOKEN'))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE_DIR = os.path.join(PROJECT_ROOT, VOICE_OUTPUT_DIR)

@bot.message_handler(commands=['start'])
def start(message):
    bot.send_message(message.chat.id, TELEGRAM_START_MSG)

@bot.message_handler(func=lambda message: True)
def echo_all(message):
    try:
        encoded_text = urllib.parse.quote(message.text)
        session_id = str(message.chat.id)
        response = requests.post(
            f"{SERVER_CHAT_URL}?query={encoded_text}&session_id={session_id}",
            timeout=30,
        )
        if response.status_code == 200:
            aisay = json.loads(response.text)
            if "msg" in aisay:
                bot.reply_to(message, aisay["msg"]["output"])
                audio_path = os.path.join(VOICE_DIR, f"{aisay['id']}.mp3")
                asyncio.run(check_audio(message, audio_path))
        else:
            bot.reply_to(message, "请求出错了哦,请稍后再试.")
    except requests.RequestException as e:
        logger.error(f"请求服务端失败: {e}")
        bot.reply_to(message, "请求出错了哦,请稍后再试.")

async def check_audio(message, audio_path):
    logger.info(f"正在等待音频文件: {audio_path}")
    for _ in range(MAX_AUDIO_WAIT):
        if os.path.exists(audio_path):
            logger.info(f"音频文件已就绪,正在发送: {audio_path}")
            try:
                with open(audio_path, 'rb') as audio_file:
                    bot.send_audio(message.chat.id, audio_file)
                os.remove(audio_path)
                logger.info(f"音频文件已发送并删除: {audio_path}")
            except Exception as e:
                logger.error(f"发送音频失败: {e}")
            return
        await asyncio.sleep(1)
    logger.warning(f"等待音频超时,文件未生成: {audio_path}")

bot.infinity_polling()
