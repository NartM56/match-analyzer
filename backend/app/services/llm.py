from openai import OpenAI

from app.core.config import settings

# One client for the whole app. The key comes from backend/.env via settings,
# so no load_dotenv() is needed. timeout: give up instead of hanging the request.
_client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=60)


def generate_text(prompt: str, instructions: str | None = None) -> str:
    """Send a prompt to the model and return its reply as plain text.

    instructions: optional rules for the model (tone, length, "use only these facts", ...),
    kept separate from the prompt itself.
    """
    response = _client.responses.create(
        model=settings.OPENAI_MODEL,
        instructions=instructions,
        input=prompt,
    )
    return response.output_text.strip()  # the text only, not the whole response object
