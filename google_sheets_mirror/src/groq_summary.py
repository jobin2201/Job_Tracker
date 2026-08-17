import hashlib
import json
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Settings
from .state_store import load_json, save_json
from .transformer import summary as local_summary


class GroqEnricher:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.cache = load_json(settings.groq_cache_file)
        self.changed = False

    @staticmethod
    def _fingerprint(description: str) -> str:
        return hashlib.sha256(("summary-v2:" + (description or "")).encode("utf-8")).hexdigest()

    def _request(self, company: str, role: str, description: str) -> dict[str, str]:
        prompt = (
            "Return strict JSON with two string fields: summary and skills. "
            "summary must be a clear 2-3 sentence job summary under 450 characters. "
            "skills must be a concise comma-separated list of the most important skills. "
            "Do not invent details.\n\n"
            f"Company: {company}\nRole: {role}\nDescription:\n{description[:14000]}"
        )
        body = json.dumps({
            "model": self.settings.groq_model,
            "messages": [
                {"role": "system", "content": "You accurately summarize job descriptions for a private job tracker."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "max_completion_tokens": 300,
            "response_format": {"type": "json_object"},
        }).encode("utf-8")
        request = Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=body,
            headers={"Authorization": f"Bearer {self.settings.groq_api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=30) as response:
            content = json.loads(response.read().decode("utf-8"))["choices"][0]["message"]["content"]
        content = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.IGNORECASE).strip()
        result = json.loads(content)
        return {
            "summary": str(result.get("summary", "")).strip()[:500],
            "skills": str(result.get("skills", "")).strip()[:1000],
        }

    def enrich(self, application: dict) -> dict[str, str]:
        description = application.get("description") or ""
        fingerprint = self._fingerprint(description)
        key = str(application["id"])
        cached = self.cache.get(key, {})
        if cached.get("fingerprint") == fingerprint:
            return {"summary": cached.get("summary", ""), "skills": cached.get("skills", "")}
        fallback = {"summary": local_summary(description, 450), "skills": ""}
        if not description or not self.settings.groq_api_key or not self.settings.groq_model:
            result = fallback
        else:
            try:
                result = self._request(application["company"], application["role"], description)
                if not result["summary"]:
                    result["summary"] = fallback["summary"]
            except (HTTPError, URLError, TimeoutError, KeyError, ValueError, json.JSONDecodeError):
                result = fallback
        self.cache[key] = {"fingerprint": fingerprint, **result}
        self.changed = True
        return result

    def save(self) -> None:
        if self.changed:
            save_json(self.settings.groq_cache_file, self.cache)
