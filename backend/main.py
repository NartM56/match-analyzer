from fastapi import FastAPI

from app.routes import competitions

app = FastAPI()

app.include_router(competitions.router, prefix="/competitions", tags=["competitions"])

@app.get("/")
def root():
    return {"status": "ok"}