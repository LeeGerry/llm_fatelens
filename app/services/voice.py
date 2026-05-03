import asyncio
import html
import logging
import os
import re

import requests

from ..config import AZURE_TTS_URL, SSML_TEMPLATE, VOICE_OUTPUT_DIR
from ..prompts import MOODS

logger = logging.getLogger(__name__)

audio_jobs: dict[str, dict[str, str]] = {}


def set_audio_status(audio_id: str, status: str, error: str | None = None):
    audio_jobs[audio_id] = {"status": status}
    if error:
        audio_jobs[audio_id]["error"] = error


def get_audio_job(audio_id: str):
    return audio_jobs.get(audio_id)


def sanitize_text_for_tts(text: str) -> str:
    cleaned = text
    cleaned = re.sub(r"```[\s\S]*?```", " ", cleaned)
    cleaned = re.sub(r"`([^`]*)`", r"\1", cleaned)
    cleaned = re.sub(r"（[^）]{1,80}）", " ", cleaned)
    cleaned = re.sub(r"\([^)]{1,80}\)", " ", cleaned)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\s*\d+\.\s+", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"[*_~>#|]", "", cleaned)
    cleaned = re.sub(r"-{3,}", "。", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


async def get_voice(text: str, uid: str, mood: str):
    speech_text = sanitize_text_for_tts(text)
    logger.info("text2speech: %s", speech_text)
    voice_key = os.getenv("AZURE_VOICE_KEY")
    if not voice_key:
        logger.warning("未配置 AZURE_VOICE_KEY,跳过语音合成")
        return False, "未配置 AZURE_VOICE_KEY"
    if not speech_text:
        logger.warning("清洗后 TTS 文本为空,跳过语音合成")
        return False, "清洗后 TTS 文本为空"

    headers = {
        "Ocp-Apim-Subscription-Key": voice_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
        "User-Agent": "TomieBot",
    }
    body = SSML_TEMPLATE.format(
        voice_style=MOODS.get(mood, MOODS["default"])["voiceStyle"],
        text=html.escape(speech_text),
    )

    response = requests.post(
        AZURE_TTS_URL,
        headers=headers,
        data=body.encode("utf-8"),
        timeout=15,
    )

    logger.info("TTS 状态码: %s, 内容长度: %s", response.status_code, len(response.content))
    if response.status_code == 200:
        os.makedirs(VOICE_OUTPUT_DIR, exist_ok=True)
        output_path = os.path.join(VOICE_OUTPUT_DIR, f"{uid}.mp3")
        with open(output_path, "wb") as audio_file:
            audio_file.write(response.content)
        logger.info("语音合成成功,文件路径: %s", output_path)
        return True, None

    logger.error("语音合成失败,状态码: %s, 响应内容: %s", response.status_code, response.text)
    return False, f"Azure TTS 返回 {response.status_code}"


def background_voice_synthesis(text: str, uid: str, mood: str):
    set_audio_status(uid, "pending")
    try:
        ok, error = asyncio.run(get_voice(text, uid, mood))
        if ok:
            set_audio_status(uid, "ready")
        else:
            set_audio_status(uid, "failed", error or "语音合成失败")
    except Exception as e:
        logger.error("后台语音合成失败: %s", e)
        set_audio_status(uid, "failed", str(e))
