#!/usr/bin/env python3
"""OAIU Telegram writing assistant. Python 3.11+, standard library only."""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import math
import os
import re
import secrets
import signal
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOG = logging.getLogger("oaiu")
FORMATS = {"speech": "🎤 Речь", "script": "🎭 Сценарий", "announcement": "📣 Анонс", "post": "📱 Пост", "thanks": "💐 Благодарность", "kit": "📦 Всё для события"}
LANGUAGES = {"ru": "Русский", "kk": "Қазақша", "en": "English"}
TONES = {"warm": "Тёплый", "formal": "Торжественный", "inspiring": "Вдохновляющий", "business": "Деловой"}
SYSTEM = """Ты редактор текстов университета OAIU. Пиши живо, грамотно и конкретно.
Готовь речи, сценарии ведущих, анонсы, посты и благодарности по заданию пользователя.
OAIU — единственное подтверждённое название: не расшифровывай его и не выдумывай
имена, должности, достижения, даты, место или программу. Если сведений нет,
оставь понятный плейсхолдер в квадратных скобках. Сохраняй предоставленные факты.
Язык задаётся в задании. Для казахского используй естественный казахский язык.
Речь должна удобно звучать вслух: короткие предложения, логичные переходы.
Обычную речь оформляй связными смысловыми абзацами по 3–5 предложений.
Не начинай новый абзац после каждого предложения. Приветствие и финальную
благодарность можно вынести отдельно. Чередуй длину предложений, избегай
цепочек однотипных коротких фраз, пустых лозунгов и повторов одной мысли.
Сценарий оформляй с ролями ведущих и ремарками. Для комплекта подготовь речь,
короткий сценарий, анонс и пост, разделив их заголовками. Объём речи считай
примерно 110–130 слов в минуту; длину остальных текстов определяй по формату.
Возвращай готовый материал без вступления «Конечно», без рассуждений, без
Markdown-таблиц и без тегов <think>. Не раскрывай свои внутренние рассуждения.
При редактировании меняй только то, о чём попросили. Не добавляй новые факты."""


class ServiceError(Exception):
    def __init__(self, service: str, status: int = 0, retry_after: int = 0, limit_kind: str = ""):
        self.service, self.status, self.retry_after = service, status, retry_after
        self.limit_kind = limit_kind
        super().__init__(f"{service}: status={status}")


def parse_delay(value):
    """Read fractional Retry-After and Groq durations such as 1m2.5s."""
    value = str(value).strip().lower()
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        seconds = float(value)
    else:
        parts = re.findall(r"(\d+(?:\.\d+)?)\s*(ms|h|m|s)", value)
        if not parts or re.sub(r"\d+(?:\.\d+)?\s*(?:ms|h|m|s)", "", value).strip():
            return 0
        seconds = sum(float(number) * {"h": 3600, "m": 60, "s": 1, "ms": 0.001}[unit] for number, unit in parts)
    return math.ceil(seconds) if math.isfinite(seconds) else 0


def load_env(path: Path) -> None:
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and key and not key.startswith("#"):
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))


@dataclass
class Config:
    token: str
    groq_key: str = ""
    model: str = "qwen/qwen3.8-27b"
    data_dir: Path = ROOT / "data"
    access_code: str = ""
    env_file: Path | None = None

    @classmethod
    def from_env(cls):
        token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,}", token):
            raise ValueError("Добавьте корректный TELEGRAM_BOT_TOKEN через setup.py.")
        return cls(token, os.getenv("GROQ_API_KEY", "").strip(), os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b"), Path(os.getenv("OAIU_DATA_DIR", str(ROOT / "data"))), os.getenv("BOT_ACCESS_CODE", "").strip())


def tls_context():
    # python.org macOS installers may not have a configured CA bundle.
    paths = ssl.get_default_verify_paths()
    if not paths.cafile and not paths.capath and Path("/etc/ssl/cert.pem").is_file():
        return ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    return ssl.create_default_context()


def request_json(url: str, service: str, payload=None, headers=None, timeout=70):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "OAIU-Bot/1.0", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=tls_context()) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        seconds = parse_delay(error.headers.get("Retry-After", "0"))
        limit_kind = ""
        with contextlib.suppress(ValueError, TypeError, KeyError, AttributeError):
            details = json.load(error)
            seconds = max(seconds, parse_delay(details.get("parameters", {}).get("retry_after", 0)))
            description = str(details.get("error", {}).get("message", "")).lower()
            if "per day" in description or "per_day" in description:
                limit_kind = "day"
            elif "per minute" in description or "per_minute" in description:
                limit_kind = "minute"
            retry = re.search(r"try again in\s+([\d.hms ]+)", description)
            if retry:
                seconds = max(seconds, parse_delay(retry.group(1).rstrip(". ")))
        raise ServiceError(service, error.code, seconds, limit_kind) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise ServiceError(service) from None
    return result


class Telegram:
    def __init__(self, token):
        self.base = f"https://api.telegram.org/bot{token}/"

    def call(self, method, payload=None):
        data = request_json(self.base + method, "Telegram", payload or {}, timeout=40 if method == "getUpdates" else 30)
        if not data.get("ok"):
            raise ServiceError("Telegram", data.get("error_code", 0), data.get("parameters", {}).get("retry_after", 0))
        return data.get("result")

    async def acall(self, method, payload=None):
        return await asyncio.to_thread(self.call, method, payload)

    async def send(self, chat_id, text, keyboard=None):
        chunks = split_text(text)
        for i, chunk in enumerate(chunks):
            body = {"chat_id": chat_id, "text": chunk, "link_preview_options": {"is_disabled": True}}
            if keyboard and i == len(chunks) - 1:
                body["reply_markup"] = {"inline_keyboard": keyboard}
            await self.acall("sendMessage", body)

    async def document(self, chat_id, text):
        boundary = "oaiu" + secrets.token_hex(12)
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"OAIU-text.txt\"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n").encode() + text.encode("utf-8-sig") + f"\r\n--{boundary}--\r\n".encode()
        def upload():
            request = urllib.request.Request(self.base + "sendDocument", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
            try:
                with urllib.request.urlopen(request, timeout=30, context=tls_context()) as response:
                    result = json.load(response)
                if not result.get("ok"):
                    raise ServiceError("Telegram", result.get("error_code", 0))
            except urllib.error.HTTPError as error:
                raise ServiceError("Telegram", error.code) from None
            except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                raise ServiceError("Telegram") from None
        await asyncio.to_thread(upload)


def split_text(text, limit=3600):
    """Bound Telegram messages in UTF-16 units without splitting emoji."""
    chunks, current, units = [], [], 0
    for char in text:
        width = 2 if ord(char) > 0xFFFF else 1
        if units + width > limit:
            chunks.append("".join(current))
            current, units = [], 0
        current.append(char)
        units += width
    if current:
        chunks.append("".join(current))
    return chunks or ["Текст пока пуст."]


def keyboard(mapping, prefix, columns=2):
    buttons = [{"text": label, "callback_data": f"{prefix}:{key}"} for key, label in mapping.items()]
    return [buttons[i:i+columns] for i in range(0, len(buttons), columns)]


RESULT_BUTTONS = [
    [{"text": "✂️ Короче", "callback_data": "edit:short"}, {"text": "✨ Торжественнее", "callback_data": "edit:formal"}],
    [{"text": "💐 Добавить благодарность", "callback_data": "edit:thanks"}],
    [{"text": "💬 Менее официально", "callback_data": "edit:simple"}, {"text": "✏️ Своя правка", "callback_data": "edit:custom"}],
    [{"text": "Қазақша", "callback_data": "translate:kk"}, {"text": "Русский", "callback_data": "translate:ru"}, {"text": "English", "callback_data": "translate:en"}],
    [{"text": "🔄 Другой вариант", "callback_data": "again:yes"}, {"text": "📄 Скачать TXT", "callback_data": "export:txt"}],
    [{"text": "➕ Новый текст", "callback_data": "new:yes"}],
]


class Store:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (chat_id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY, chat_id INTEGER, title TEXT, text TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, context TEXT);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS authorized (chat_id INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS quota (chat_id INTEGER, created REAL);
        CREATE TABLE IF NOT EXISTS generation_jobs (chat_id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        """)
        if "context" not in {row[1] for row in self.db.execute("PRAGMA table_info(drafts)")}:
            self.db.execute("ALTER TABLE drafts ADD COLUMN context TEXT")
        self.db.commit()
        with contextlib.suppress(OSError):
            path.chmod(0o600)

    def get(self, chat_id):
        with self.lock:
            row = self.db.execute("SELECT value FROM sessions WHERE chat_id=?", (chat_id,)).fetchone()
            return json.loads(row[0]) if row else {"step": "type"}

    def put(self, chat_id, value):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO sessions VALUES (?,?)", (chat_id, json.dumps(value, ensure_ascii=False)))

    def allow(self, chat_id):
        with self.lock, self.db:
            self.db.execute("INSERT OR IGNORE INTO authorized VALUES (?)", (chat_id,))

    def allowed(self, chat_id):
        with self.lock:
            return bool(self.db.execute("SELECT 1 FROM authorized WHERE chat_id=?", (chat_id,)).fetchone())

    def add_draft(self, chat_id, title, text, session=None):
        with self.lock, self.db:
            context = {key: value for key, value in (session or {}).items() if key not in {"result", "pending_instruction"}}
            self.db.execute("INSERT INTO drafts(chat_id,title,text,context) VALUES (?,?,?,?)", (chat_id, title[:100], text, json.dumps(context, ensure_ascii=False)))
            self.db.execute("DELETE FROM drafts WHERE chat_id=? AND id NOT IN (SELECT id FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 10)", (chat_id, chat_id))

    def drafts(self, chat_id):
        with self.lock:
            return self.db.execute("SELECT id,title,created FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 5", (chat_id,)).fetchall()

    def draft(self, chat_id, draft_id):
        with self.lock:
            row = self.db.execute("SELECT text FROM drafts WHERE chat_id=? AND id=?", (chat_id, draft_id)).fetchone()
            return row[0] if row else None

    def draft_context(self, chat_id, draft_id):
        with self.lock:
            row = self.db.execute("SELECT context FROM drafts WHERE chat_id=? AND id=?", (chat_id, draft_id)).fetchone()
            return json.loads(row[0]) if row and row[0] else {}

    def delete_user(self, chat_id):
        with self.lock, self.db:
            for table in ("sessions", "drafts", "quota", "generation_jobs"):
                self.db.execute(f"DELETE FROM {table} WHERE chat_id=?", (chat_id,))

    def quota(self, chat_id, now=None):
        now = time.time() if now is None else now
        with self.lock, self.db:
            self.db.execute("DELETE FROM quota WHERE created<?", (now-60,))
            personal = self.db.execute("SELECT count(*) FROM quota WHERE chat_id=?", (chat_id,)).fetchone()[0]
            total = self.db.execute("SELECT count(*) FROM quota").fetchone()[0]
            if personal >= 4 or total >= 20:
                return False
            self.db.execute("INSERT INTO quota VALUES (?,?)", (chat_id, now))
            return True

    def pause_for(self, seconds, kind="", now=None):
        now = time.time() if now is None else now
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO meta VALUES ('groq_pause',?)", (json.dumps({"until": now + seconds, "kind": kind}),))

    def remaining_pause(self, now=None):
        now = time.time() if now is None else now
        with self.lock:
            row = self.db.execute("SELECT value FROM meta WHERE key='groq_pause'").fetchone()
        data = json.loads(row[0]) if row else {}
        return max(0, math.ceil(data.get("until", 0) - now)), data.get("kind", "")

    def quota_delay(self, chat_id):
        now = time.time()
        with self.lock:
            own = [row[0] for row in self.db.execute("SELECT created FROM quota WHERE chat_id=? AND created>=? ORDER BY created", (chat_id, now-60))]
            all_requests = [row[0] for row in self.db.execute("SELECT created FROM quota WHERE created>=? ORDER BY created", (now-60,))]
        deadlines = [own[0]+61] if len(own) >= 4 else []
        if len(all_requests) >= 20:
            deadlines.append(all_requests[0]+61)
        return max(1, math.ceil(max(deadlines, default=now+1)-now))

    def job(self, chat_id):
        with self.lock:
            row = self.db.execute("SELECT value FROM generation_jobs WHERE chat_id=?", (chat_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def jobs(self):
        with self.lock:
            return [(chat_id, json.loads(value)) for chat_id, value in self.db.execute("SELECT chat_id,value FROM generation_jobs ORDER BY rowid")]

    def save_job(self, chat_id, job):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO generation_jobs VALUES (?,?)", (chat_id, json.dumps(job, ensure_ascii=False)))

    def update_job(self, chat_id, job_id, **changes):
        with self.lock, self.db:
            job = self.job(chat_id)
            if not job or job["id"] != job_id:
                return False
            job.update(changes)
            self.save_job(chat_id, job)
            return True

    def remove_job(self, chat_id, job_id=None):
        with self.lock, self.db:
            job = self.job(chat_id)
            if job and (job_id is None or job["id"] == job_id):
                self.db.execute("DELETE FROM generation_jobs WHERE chat_id=?", (chat_id,))

    def finish_job(self, chat_id, job_id, session, result):
        # Keep a ready answer durably until Telegram accepts its delivery.
        with self.lock, self.db:
            job = self.job(chat_id)
            if not job or job["id"] != job_id:
                return False
            if job.get("result"):
                return True
            session = {**session, "step": "ready", "result": result}
            session.pop("pending_instruction", None)
            context = {key: value for key, value in session.items() if key != "result"}
            title = session.get("brief", "Текст OAIU").splitlines()[0][:100]
            self.db.execute("INSERT OR REPLACE INTO sessions VALUES (?,?)", (chat_id, json.dumps(session, ensure_ascii=False)))
            self.db.execute("INSERT INTO drafts(chat_id,title,text,context) VALUES (?,?,?,?)", (chat_id, title, result, json.dumps(context, ensure_ascii=False)))
            self.db.execute("DELETE FROM drafts WHERE chat_id=? AND id NOT IN (SELECT id FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 10)", (chat_id, chat_id))
            job["result"] = result
            self.db.execute("UPDATE generation_jobs SET value=? WHERE chat_id=?", (json.dumps(job, ensure_ascii=False), chat_id))
            return True

    def migrate_waiting_requests(self):
        """Adopt the last unfulfilled request from the previous manual-retry version."""
        with self.lock, self.db:
            if self.db.execute("SELECT 1 FROM meta WHERE key='automatic_wait_migrated'").fetchone():
                return
            for chat_id, raw in self.db.execute("SELECT chat_id,value FROM sessions").fetchall():
                session = json.loads(raw)
                if "pending_instruction" in session and session.get("brief") and not self.job(chat_id):
                    job = {"id": secrets.token_hex(12), "session": session, "instruction": session["pending_instruction"], "notice_sent": False}
                    self.db.execute("INSERT INTO generation_jobs VALUES (?,?)", (chat_id, json.dumps(job, ensure_ascii=False)))
            self.db.execute("INSERT INTO meta VALUES ('automatic_wait_migrated','1')")

    def enqueue(self, updates):
        with self.lock, self.db:
            for update in updates:
                self.db.execute("INSERT OR IGNORE INTO inbox VALUES (?,?)", (update["update_id"], json.dumps(update, ensure_ascii=False)))
            if updates:
                self.db.execute("INSERT OR REPLACE INTO meta VALUES ('offset',?)", (str(max(u["update_id"] for u in updates)+1),))

    def offset(self):
        with self.lock:
            row = self.db.execute("SELECT value FROM meta WHERE key='offset'").fetchone()
            return int(row[0]) if row else 0

    def pending(self):
        with self.lock:
            return [(i, json.loads(payload)) for i, payload in self.db.execute("SELECT id,payload FROM inbox ORDER BY id")]

    def done(self, update_id):
        with self.lock, self.db:
            self.db.execute("DELETE FROM inbox WHERE id=?", (update_id,))


class Generator:
    def __init__(self, config):
        self.config = config

    def generate(self, messages):
        if not self.config.groq_key:
            raise ServiceError("Configuration")
        payload = {
            "model": self.config.model, "messages": [{"role": "system", "content": SYSTEM}, *messages],
            "temperature": 0.75, "max_completion_tokens": output_budget(messages),
        }
        if self.config.model == "qwen/qwen3.8-27b":
            payload.update(reasoning_effort="none", reasoning_format="hidden")
        response = request_json("https://api.groq.com/openai/v1/chat/completions", "Groq", payload, {"Authorization": "Bearer " + self.config.groq_key})
        try:
            choice = response["choices"][0]
            text = choice["message"]["content"]
            text = re.sub(r"<think>.*?(?:</think>|$)", "", text, flags=re.S).strip()
            if not text:
                raise ValueError()
            if choice.get("finish_reason") == "length":
                text += "\n\n[Достигнут предел ответа. Попросите продолжить или сократить текст.]"
            return text
        except (KeyError, IndexError, TypeError, ValueError):
            raise ServiceError("Groq", 502) from None


def output_budget(messages):
    """Reserve a sensible answer size instead of 3200 tokens for every click."""
    prompt = messages[0].get("content", "") if messages else ""
    match = re.search(r"Объём: ([135]) мин", prompt)
    budget = {"1": 900, "3": 1800, "5": 2800}.get(match.group(1) if match else "3", 1800)
    if "Формат: 📣 Анонс" in prompt or "Формат: 📱 Пост" in prompt:
        budget = 900
    elif "Формат: 💐 Благодарность" in prompt:
        budget = 1100
    elif "Формат: 📦 Всё для события" in prompt:
        budget = 3000
    elif "Формат: 🎭 Сценарий" in prompt:
        budget = max(budget, 2000)
    if len(messages) >= 3:
        # Translation and custom edits may apply to a long existing document.
        original_size = len(messages[-2].get("content", ""))
        budget = min(3200, max(budget, math.ceil(original_size / 2) + 300))
    return budget


def brief_prompt(session):
    return (f"Формат: {FORMATS.get(session.get('format'), 'Текст по запросу')}.\n"
            f"Язык: {LANGUAGES.get(session.get('language', 'ru'), 'сохранить язык исходного текста')}.\n"
            f"Тон: {TONES.get(session.get('tone', 'warm'), 'Тёплый')}.\n"
            f"Объём: {session.get('length', '3')} мин для речи; для других форматов — соразмерно задаче.\n"
            f"Задание и подтверждённые сведения:\n{session.get('brief', '')}")


class Bot:
    def __init__(self, config, api, store, generator):
        self.config, self.api, self.store, self.generator = config, api, store, generator
        self.locks = {}
        self.capacity = asyncio.Semaphore(1)
        self.workers = {}
        self.sleep = asyncio.sleep

    async def menu(self, chat_id):
        await self.cancel_job(chat_id)
        self.store.put(chat_id, {"step": "type"})
        await self.api.send(chat_id, "Привет! Я OAIU Помощник. Подготовлю текст для университетского события.\n\nЧто создадим?", keyboard(FORMATS, "type"))

    async def handle(self, update):
        callback = update.get("callback_query")
        message = callback.get("message", {}) if callback else update.get("message", {})
        chat = message.get("chat", {})
        chat_id = chat.get("id")
        if callback:
            with contextlib.suppress(ServiceError):
                await self.api.acall("answerCallbackQuery", {"callback_query_id": callback["id"]})
        if chat_id is None or chat.get("type") != "private":
            return
        async with self.locks.setdefault(chat_id, asyncio.Lock()):
            try:
                await self.process(chat_id, message.get("text", ""), callback.get("data", "") if callback else "")
            except ServiceError as error:
                LOG.warning("Request failed: service=%s status=%s", error.service, error.status)
                with contextlib.suppress(ServiceError):
                    await self.api.send(chat_id, "Не удалось отправить ответ. Попробуйте /new ещё раз.")
            except Exception as error:
                LOG.error("Handler failed: %s", type(error).__name__)
                with contextlib.suppress(ServiceError):
                    await self.api.send(chat_id, "Возникла ошибка. Ваш последний черновик сохранён. Начать заново: /new")

    async def process(self, chat_id, text, callback):
        text = text.strip()
        command = text.split(maxsplit=1)[0].split("@")[0] if text.startswith("/") else ""
        if self.config.access_code and not self.store.allowed(chat_id):
            parts = text.split(maxsplit=1)
            if command == "/start" and len(parts) == 2 and secrets.compare_digest(parts[1], self.config.access_code):
                self.store.allow(chat_id)
            else:
                await self.api.send(chat_id, "Бот работает по приглашению. Откройте ссылку доступа, которую выдаёт владелец.")
                return
        if command in ("/start", "/new", "/cancel") or callback == "new:yes":
            await self.menu(chat_id)
            return
        if command == "/help":
            await self.api.send(chat_id, "Выберите формат, язык, объём и тон, затем опишите событие. После ответа можно написать правки обычным сообщением.\n\n/new — новый текст\n/history — последние черновики\n/privacy — обработка данных\n/delete — удалить сохранённые тексты\n/cancel — отменить текущую задачу")
            return
        if command == "/privacy":
            await self.api.send(chat_id, "Сообщения проходят через Telegram. Для генерации описание события и текущий текст отправляются в Groq; идентификатор Telegram в запрос модели не входит. На компьютере или сервере владельца хранятся текущая задача и до 10 последних версий текста. /delete удаляет эти локальные записи, но не переписку и данные у Telegram или Groq.")
            return
        if command == "/delete":
            await self.api.send(chat_id, "Удалить текущую задачу и все ваши сохранённые черновики из базы бота?", [[{"text": "Удалить мои тексты", "callback_data": "delete:confirm"}, {"text": "Отмена", "callback_data": "delete:cancel"}]])
            return
        if callback == "delete:confirm":
            await self.cancel_job(chat_id)
            self.store.delete_user(chat_id)
            await self.api.send(chat_id, "Ваши тексты удалены из базы бота. Новый текст: /new")
            return
        if callback == "delete:cancel":
            await self.api.send(chat_id, "Сохранённые тексты оставлены.")
            return
        if command == "/history":
            drafts = self.store.drafts(chat_id)
            rows = [[{"text": title[:45] or created, "callback_data": f"history:{draft_id}"}] for draft_id, title, created in drafts]
            await self.api.send(chat_id, "Ваши последние черновики:" if drafts else "Черновиков пока нет. Создать первый: /new", rows or None)
            return
        session = self.store.get(chat_id)
        if callback.startswith("history:"):
            draft_id = callback.partition(":")[2]
            result = self.store.draft(chat_id, int(draft_id)) if draft_id.isdigit() else None
            if not result:
                await self.api.send(chat_id, "Этот черновик недоступен. Обновите список: /history")
                return
            # Restored drafts carry their own factual context, not a different current task.
            context = self.store.draft_context(chat_id, int(draft_id))
            session = {"step": "ready", "format": "speech", "language": "auto", "tone": "warm", "length": "3", "brief": "Отредактировать сохранённый текст, сохранив содержащиеся в нём факты.", **context, "result": result}
            self.store.put(chat_id, session)
            await self.api.send(chat_id, result, RESULT_BUTTONS)
            return
        if callback.startswith("type:"):
            value = callback.partition(":")[2]
            if value not in FORMATS:
                return
            session = {"step": "language", "format": value}
            self.store.put(chat_id, session)
            await self.api.send(chat_id, "На каком языке подготовить текст?", keyboard(LANGUAGES, "language", 3))
            return
        if callback.startswith("language:"):
            value = callback.partition(":")[2]
            if session.get("step") != "language" or value not in LANGUAGES:
                await self.api.send(chat_id, "Эта кнопка относится к другой задаче. Начать новую: /new")
                return
            session.update(language=value, step="length")
            self.store.put(chat_id, session)
            await self.api.send(chat_id, "Какой объём нужен? Для речи — примерное время выступления; для других форматов — степень подробности.", keyboard({"1": "Коротко · ~1 мин", "3": "Стандарт · ~3 мин", "5": "Подробно · ~5 мин"}, "length", 1))
            return
        if callback.startswith("length:"):
            value = callback.partition(":")[2]
            if session.get("step") != "length" or value not in {"1", "3", "5"}:
                return
            session.update(length=value, step="tone")
            self.store.put(chat_id, session)
            await self.api.send(chat_id, "Выберите настроение текста:", keyboard(TONES, "tone"))
            return
        if callback.startswith("tone:"):
            value = callback.partition(":")[2]
            if session.get("step") != "tone" or value not in TONES:
                return
            session.update(tone=value, step="brief")
            self.store.put(chat_id, session)
            await self.api.send(chat_id, "Теперь опишите событие одним сообщением: название, аудитория, от чьего имени текст, главная мысль, дата и место — если известны.\n\nНапример: «Посвящение в студенты OAIU. Выступает преподаватель. Поздравить первокурсников, пожелать смелости и новых знакомств. Без лишнего официоза».\n\nИмена и неизвестные факты я придумывать не буду.")
            return
        if callback == "export:txt":
            if session.get("result"):
                await self.api.document(chat_id, session["result"])
            else:
                await self.api.send(chat_id, "Сначала создайте текст: /new")
            return
        if callback == "again:yes":
            if session.get("brief"):
                await self.generate(chat_id, session)
            return
        if callback == "retry:yes":
            if session.get("brief"):
                await self.generate(chat_id, session, session.get("pending_instruction"))
            return
        if callback == "edit:custom":
            if session.get("result"):
                await self.api.send(chat_id, "Напишите, что изменить в текущем тексте.")
            else:
                await self.api.send(chat_id, "Сначала создайте текст: /new")
            return
        if callback.startswith(("edit:", "translate:")):
            if not session.get("result"):
                return
            if callback == "edit:short":
                instruction = "Сократи текущий текст примерно вдвое, сохранив ключевые мысли и факты. Язык не меняй."
            elif callback == "edit:formal":
                instruction = "Сделай текст торжественнее, сохранив естественную речь, факты и язык."
            elif callback == "edit:thanks":
                instruction = "Добавь уместную благодарность преподавателям. Сохрани язык, смысл и факты; имена не придумывай."
            elif callback == "edit:simple":
                instruction = "Сделай текст менее официальным, живым и естественным. Сохрани язык и факты."
            elif callback.partition(":")[0] == "translate" and callback.partition(":")[2] in LANGUAGES:
                language = callback.partition(":")[2]
                instruction = f"Переведи текст на {LANGUAGES[language]}, сохрани смысл и факты."
                session = {**session, "language": language}
            else:
                return
            await self.generate(chat_id, session, instruction)
            return
        if command:
            await self.api.send(chat_id, "Такой команды пока нет. Подсказки: /help")
            return
        if not text:
            await self.api.send(chat_id, "Пока я работаю с текстовыми сообщениями. Напишите описание события или начните с /new.")
            return
        if len(text) > 3000:
            await self.api.send(chat_id, "Сократите сообщение до 3000 символов: оставьте основные факты и пожелания.")
            return
        if session.get("step") == "ready" and session.get("result"):
            await self.generate(chat_id, session, text)
        elif session.get("step") == "brief":
            session["brief"] = text
            self.store.put(chat_id, session)
            await self.generate(chat_id, session)
        elif session.get("step") == "type":
            session = {"step": "brief", "format": "speech", "language": "ru", "length": "3", "tone": "warm", "brief": text}
            self.store.put(chat_id, session)
            await self.generate(chat_id, session)
        else:
            await self.api.send(chat_id, "Сначала выберите вариант кнопкой выше. Или начните заново: /new")

    async def generate(self, chat_id, session, instruction=None):
        # Pick up a key entered by the owner without stopping the active bot.
        if self.config.env_file and self.config.env_file.is_file():
            values = {}
            for line in self.config.env_file.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator:
                    values[key.strip()] = value.strip().strip('"').strip("'")
            self.config.groq_key = values.get("GROQ_API_KEY", self.config.groq_key)
            self.config.model = values.get("GROQ_MODEL", self.config.model)
        session["pending_instruction"] = instruction
        self.store.put(chat_id, session)
        if not self.config.groq_key:
            retry_button = [[{"text": "Повторить", "callback_data": "retry:yes"}]]
            await self.api.send(chat_id, "Меню уже работает. Для AI-ответов владелец должен добавить GROQ_API_KEY в настройки. Ваше описание сохранено — после подключения нажмите «Повторить».", retry_button)
            return
        existing = self.store.job(chat_id)
        keys = ("format", "language", "tone", "length", "brief", "result")
        if existing and existing["instruction"] == instruction and all(existing["session"].get(key) == session.get(key) for key in keys):
            self.start_worker(chat_id)
            return
        notice_sent = bool(existing and existing.get("notice_sent"))
        await self.cancel_job(chat_id)
        job = {"id": secrets.token_hex(12), "session": session, "instruction": instruction, "notice_sent": notice_sent}
        self.store.save_job(chat_id, job)
        self.start_worker(chat_id)

    def start_worker(self, chat_id):
        if chat_id in self.workers and not self.workers[chat_id].done():
            return
        job = self.store.job(chat_id)
        if not job:
            return
        task = asyncio.create_task(self.run_job(chat_id, job["id"]))
        self.workers[chat_id] = task
        def finished(done):
            if self.workers.get(chat_id) is done:
                self.workers.pop(chat_id, None)
            if not done.cancelled() and done.exception():
                LOG.error("Generation worker failed: %s", type(done.exception()).__name__)
        task.add_done_callback(finished)

    def resume_jobs(self):
        for chat_id, _job in self.store.jobs():
            self.start_worker(chat_id)

    async def cancel_job(self, chat_id):
        task = self.workers.pop(chat_id, None)
        self.store.remove_job(chat_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def wait_idle(self):
        while self.workers:
            await asyncio.gather(*list(self.workers.values()))

    async def shutdown(self):
        tasks = list(self.workers.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def run_job(self, chat_id, job_id):
        job = self.store.job(chat_id)
        if not job or job["id"] != job_id:
            return
        if not job.get("notice_sent"):
            await self.api.send(chat_id, "Готовлю текст…")
            self.store.update_job(chat_id, job_id, notice_sent=True)
        session, instruction = job["session"], job["instruction"]
        messages = [{"role": "user", "content": brief_prompt(session)}]
        if instruction and session.get("result"):
            messages += [{"role": "assistant", "content": session["result"]}, {"role": "user", "content": instruction}]
        while True:
            job = self.store.job(chat_id)
            if not job or job["id"] != job_id:
                return
            if job.get("result"):
                await self.api.send(chat_id, job["result"], RESULT_BUTTONS)
                self.store.remove_job(chat_id, job_id)
                return
            seconds, _kind = self.store.remaining_pause()
            if seconds:
                await self.sleep(min(seconds, 30))
                continue
            async with self.capacity:
                if self.store.remaining_pause()[0]:
                    continue
                if not self.store.quota(chat_id):
                    delay = self.store.quota_delay(chat_id)
                else:
                    delay = 0
                    with contextlib.suppress(ServiceError):
                        await self.api.acall("sendChatAction", {"chat_id": chat_id, "action": "typing"})
                    try:
                        result = await asyncio.to_thread(self.generator.generate, messages)
                    except ServiceError as error:
                        LOG.warning("Generation failed: service=%s status=%s", error.service, error.status)
                        if error.status == 429:
                            seconds = error.retry_after or (86400 if error.limit_kind == "day" else 60)
                            self.store.pause_for(seconds, error.limit_kind)
                            continue
                        if error.status in {401, 403}:
                            message = "Не удалось получить текст: владельцу нужно проверить API-ключ и доступ к модели."
                        elif error.status in {400, 404}:
                            message = "Не удалось получить текст: владельцу нужно проверить настройки модели."
                        else:
                            message = "Не удалось получить текст. Задание и последний черновик сохранены."
                        await self.api.send(chat_id, message, [[{"text": "Повторить", "callback_data": "retry:yes"}]])
                        self.store.remove_job(chat_id, job_id)
                        return
                    self.store.finish_job(chat_id, job_id, session, result)
            if delay:
                await self.sleep(min(delay, 30))


async def run(config):
    api = Telegram(config.token)
    me = await api.acall("getMe")
    webhook = await api.acall("getWebhookInfo")
    if webhook.get("url"):
        print("У бота уже настроен webhook. Остановите прежнее подключение перед запуском этой версии.")
        return
    store = Store(config.data_dir / "oaiu.sqlite3")
    bot = Bot(config, api, store, Generator(config))
    store.migrate_waiting_requests()
    await api.acall("setMyCommands", {"commands": [{"command": cmd, "description": desc} for cmd, desc in [("start", "Начать работу"), ("new", "Создать новый текст"), ("history", "Последние черновики"), ("help", "Как пользоваться"), ("privacy", "Обработка данных"), ("delete", "Удалить мои тексты"), ("cancel", "Отменить текущую задачу")]]})
    print(f"Бот запущен: https://t.me/{me['username']}", flush=True)
    if config.access_code:
        print("Ссылка приглашения сохранена в private-invite.txt рядом с файлом настроек.", flush=True)
    print("AI: " + ("Groq подключён" if config.groq_key else "ожидает GROQ_API_KEY"), flush=True)
    print("Для остановки нажмите Ctrl+C. Компьютер должен оставаться включённым.", flush=True)
    tasks, scheduled = set(), set()
    async def consume(update_id, update):
        try:
            await bot.handle(update)
            store.done(update_id)
        finally:
            scheduled.discard(update_id)
    failures = 0
    try:
        while True:
            bot.resume_jobs()
            for update_id, update in store.pending():
                if update_id not in scheduled:
                    scheduled.add(update_id)
                    task = asyncio.create_task(consume(update_id, update))
                    tasks.add(task)
                    task.add_done_callback(tasks.discard)
            try:
                updates = await api.acall("getUpdates", {"offset": store.offset(), "timeout": 25, "limit": 50, "allowed_updates": ["message", "callback_query"]})
                store.enqueue(updates)
                failures = 0
            except ServiceError as error:
                if error.status in {401, 404, 409}:
                    print("Telegram: неверный токен или этот бот уже запущен в другом процессе. Проверьте настройки.")
                    break
                failures += 1
                LOG.warning("Polling failed: status=%s", error.status)
                await asyncio.sleep(max(error.retry_after, min(2**min(failures, 5), 30)))
    finally:
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        await bot.shutdown()
        store.db.close()


def main():
    parser = argparse.ArgumentParser(description="OAIU Telegram assistant")
    parser.add_argument("--env", type=Path, default=ROOT / ".env")
    args = parser.parse_args()
    load_env(args.env)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        config = Config.from_env()
        config.env_file = args.env.resolve()
        config.data_dir.mkdir(parents=True, exist_ok=True)
        # One process per data directory; Telegram rejects other pollers as well.
        with open(config.data_dir / ".bot.lock", "a") as lockfile:
            if os.name != "nt":
                import fcntl
                try:
                    fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise ValueError("Бот уже запущен из этой папки.") from None
            asyncio.run(run(config))
    except KeyboardInterrupt:
        print("\nБот остановлен.")
    except ValueError as error:
        print(error)
        raise SystemExit(1)
    except ServiceError as error:
        print(f"Нет соединения с {error.service} (код {error.status}). Проверьте интернет и ключи.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
