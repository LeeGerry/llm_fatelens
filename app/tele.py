import telebot
import requests
import urllib.parse
import json
import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

bot = telebot.TeleBot(os.getenv('TELEGRAM_BOT_TOKEN'))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE_DIR = os.path.join(PROJECT_ROOT, "voices")

@bot.message_handler(commands=['start'])
def start(message):
    bot.send_message(message.chat.id, "你好,我是陈瞎子,专门算命测八字,请问你想算什么?")

@bot.message_handler(func=lambda message: True)
def echo_all(message):
    try:
        encoded_text = urllib.parse.quote(message.text)
        response = requests.post(f"http://localhost:8000/chat?query={encoded_text}", timeout = 30)
        if response.status_code == 200:
            aisay = json.loads(response.text)
            if "msg" in aisay:
                bot.reply_to(message, aisay["msg"]["output"])
                audio_path = os.path.join(VOICE_DIR, f"{aisay['id']}.mp3")
                asyncio.run(check_audio(message, audio_path))
        else:
            bot.reply_to(message, "请求出错了哦,请稍后再试.")  
    except requests.RequestException as e:
        bot.reply_to(message, "请求出错了哦,请稍后再试.")
        
async def check_audio(message, audio_path):
    print(f"=====\n正在检查音频文件 {audio_path} 是否存在...")
    while True:
        if os.path.exists(audio_path):
            print(f"=====\n音频文件 {audio_path} 已经存在,正在发送...")
            with open(audio_path, 'rb') as audio_file:
                bot.send_audio(message.chat.id, audio_file)
            os.remove(audio_path)
            print(f"=====\n音频文件 {audio_path} 已经发送并删除.")
            break
        else:
            print(f"=====\n音频文件 {audio_path} 不存在,正在等待...")
            await asyncio.sleep(1)
        
bot.infinity_polling()