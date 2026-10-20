from fastapi import FastAPI

from app.routes import compare, competitions, matches

app = FastAPI()

app.include_router(competitions.router, prefix="/competitions", tags=["competitions"])
app.include_router(matches.router, prefix="/matches", tags=["matches"])
app.include_router(compare.router, prefix="/compare", tags=["compare"])

@app.get("/")
def root():
    return {"status": "ok"}