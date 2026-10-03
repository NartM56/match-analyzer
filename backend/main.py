from fastapi import FastAPI

from app.routes import competitions, matches

app = FastAPI()

app.include_router(competitions.router, prefix="/competitions", tags=["competitions"])
app.include_router(matches.router, prefix="/matches", tags=["matches"])

@app.get("/")
def root():
    return {"status": "ok"}