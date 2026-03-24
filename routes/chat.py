from fastapi import APIRouter
from app.schemas import ChatRequest, ChatResponse
from app.agent import run_agent

router = APIRouter()

@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    result = run_agent(req.session_id, req.message)
    return ChatResponse(**result)