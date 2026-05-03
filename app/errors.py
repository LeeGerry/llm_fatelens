from fastapi.responses import JSONResponse


def error_payload(error_code: str, message: str):
    return {"ok": False, "error_code": error_code, "message": message}


def error_response(error_code: str, message: str, status_code: int = 500):
    return JSONResponse(
        status_code=status_code,
        content=error_payload(error_code, message),
    )
