#!/usr/bin/env python3
"""Interactive credential setup. Secrets never appear in command arguments."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import sys

from bot import ROOT, ServiceError, Telegram, load_env, request_json


def write_private(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        file.write(text)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def configure():
    parser = argparse.ArgumentParser(description="Настройка OAIU бота")
    parser.add_argument("--env", type=Path, default=ROOT / ".env")
    parser.add_argument("--token-stdin", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--groq-only", action="store_true", help="Добавить только ключ Groq")
    args = parser.parse_args()
    load_env(args.env)
    if args.token_stdin:
        if sys.stdin.isatty():
            import termios
            state = termios.tcgetattr(sys.stdin)
            hidden = termios.tcgetattr(sys.stdin)
            hidden[3] &= ~termios.ECHO
            termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
            print("Ready for token on hidden stdin", flush=True)
            try:
                token = sys.stdin.readline().strip()
            finally:
                termios.tcsetattr(sys.stdin, termios.TCSANOW, state)
        else:
            token = sys.stdin.readline().strip()
        groq_key = os.getenv("GROQ_API_KEY", "")
    elif args.groq_only:
        token = os.getenv("TELEGRAM_BOT_TOKEN", "")
        print("Подключение AI к OAIU боту. Получите ключ: https://console.groq.com/keys\nКлюч при вводе не отображается.\n")
        groq_key = getpass.getpass("Groq API key: ").strip()
        if not groq_key:
            raise ValueError("Ключ не введён. Настройки не изменены.")
    else:
        print("OAIU Помощник — настройка\nКлючи при вводе не отображаются. Enter сохраняет прежнее значение.\n")
        token = getpass.getpass("Токен @BotFather: ").strip() or os.getenv("TELEGRAM_BOT_TOKEN", "")
        groq_key = getpass.getpass("Groq API key (можно добавить позже): ").strip() or os.getenv("GROQ_API_KEY", "")
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,}", token):
        raise ValueError("Токен не похож на токен BotFather. Проверьте, что скопировали его полностью.")
    if "\n" in groq_key or "\r" in groq_key:
        raise ValueError("Ключ должен занимать одну строку.")
    me = Telegram(token).call("getMe")
    model = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
    if groq_key:
        models = request_json("https://api.groq.com/openai/v1/models", "Groq", headers={"Authorization": "Bearer " + groq_key})
        if model not in {item["id"] for item in models.get("data", [])}:
            raise ValueError("Текущая модель недоступна этому ключу. Выберите доступную модель в GROQ_MODEL.")
    access_code = os.getenv("BOT_ACCESS_CODE") or secrets.token_urlsafe(18)
    data_dir = args.env.resolve().parent / "data"
    lines = {"TELEGRAM_BOT_TOKEN": token, "GROQ_API_KEY": groq_key, "GROQ_MODEL": model, "BOT_ACCESS_CODE": access_code, "OAIU_DATA_DIR": str(data_dir)}
    write_private(args.env.resolve(), "\n".join(f"{key}={value}" for key, value in lines.items()) + "\n")
    write_private(args.env.resolve().parent / "private-invite.txt", f"https://t.me/{me['username']}?start={access_code}\n")
    print(json.dumps({"ok": True, "username": me["username"], "id": me["id"], "ai_configured": bool(groq_key), "invite_file": str(args.env.resolve().parent / "private-invite.txt")}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        configure()
    except ServiceError as error:
        print(f"Проверка не прошла: {error.service}, код {error.status}. Настройки не изменены.")
        raise SystemExit(1)
    except (ValueError, KeyboardInterrupt) as error:
        print(str(error) if isinstance(error, ValueError) else "Настройка отменена.")
        raise SystemExit(1)
