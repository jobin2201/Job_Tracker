import json
from pathlib import Path


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def stable_application_numbers(applications: list[dict], existing: dict) -> dict[int, str]:
    mapping = {int(key): str(value) for key, value in existing.items() if str(key).isdigit()}
    highest = max((int(value) for value in mapping.values() if str(value).isdigit()), default=0)
    ordered = sorted(applications, key=lambda item: (item["created_at"], item["id"]))
    for application in ordered:
        database_id = int(application["id"])
        if database_id not in mapping:
            highest += 1
            mapping[database_id] = f"{highest:03d}"
    return mapping
