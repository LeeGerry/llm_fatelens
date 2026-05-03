import logging
import os
import time
from pathlib import Path

from .config import DEMO_MODE, VOICE_OUTPUT_DIR

logger = logging.getLogger(__name__)

REQUIRED_CONFIG = [
    "REDIS_URL",
    "AZURE_VOICE_KEY",
    "YUANFENJU_API_KEY",
]


def validate_runtime_config():
    required = list(REQUIRED_CONFIG)
    if not DEMO_MODE:
        required.append("DEEPSEEK_API_KEY")

    missing = [name for name in required if not os.getenv(name)]
    if not missing:
        logger.info("配置校验通过")
        return

    logger.warning("缺少配置: %s", ", ".join(missing))
    if "DEEPSEEK_API_KEY" in missing:
        logger.warning("LLM 调用会失败。临时演示可设置 DEMO_MODE=true")
    if "REDIS_URL" in missing:
        logger.warning("未设置 REDIS_URL,将回退 redis://localhost:6379/0")
    if "AZURE_VOICE_KEY" in missing:
        logger.warning("语音合成会标记为 failed,前端可显示重试")
    if "YUANFENJU_API_KEY" in missing:
        logger.warning("八字/摇卦工具会回退到一般性回答")


def cleanup_old_voice_files(max_age_hours: int = 24):
    voice_dir = Path(VOICE_OUTPUT_DIR)
    if not voice_dir.exists():
        return

    cutoff = time.time() - max_age_hours * 60 * 60
    removed = 0
    for path in voice_dir.glob("*.mp3"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError as e:
            logger.warning("清理语音文件失败 %s: %s", path, e)

    if removed:
        logger.info("已清理 %s 个超过 %s 小时的语音文件", removed, max_age_hours)
