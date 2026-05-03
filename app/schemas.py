from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="用户输入消息")
    session_id: str = Field(default="default", description="会话 ID,移动端可使用用户或设备 ID")
    with_voice: bool = Field(default=True, description="是否在后台生成语音")


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    message_id: str
    mood: str
    audio_url: str | None = None
    audio_status_url: str | None = None
    raw: dict | None = None


class AudioStatusResponse(BaseModel):
    id: str
    status: str
    audio_url: str | None = None
