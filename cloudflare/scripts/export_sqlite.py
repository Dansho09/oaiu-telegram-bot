#!/usr/bin/env python3
"""Export a stopped Python bot's SQLite snapshot to a PRIVATE JSON file."""
import argparse
import json
import sqlite3
from pathlib import Path

COLUMNS = {
    "sessions": ["chat_id", "value"],
    "drafts": ["id", "chat_id", "title", "text", "created", "context"],
    "meta": ["key", "value"],
    "authorized": ["chat_id"],
    "quota": ["chat_id", "created"],
    "generation_jobs": ["chat_id", "value"],
    "inbox": ["id", "payload"],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; choose a new private backup path.")
    db = sqlite3.connect(f"file:{args.database.resolve()}?mode=ro", uri=True)
    try:
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            parser.error("Database integrity check failed.")
        tables = {table: db.execute(f"SELECT {','.join(columns)} FROM {table}").fetchall() for table, columns in COLUMNS.items()}
    finally:
        db.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as stream:
        args.output.chmod(0o600)
        json.dump({"version": 1, "tables": tables}, stream, ensure_ascii=False)
    print("Private backup exported:", {table: len(rows) for table, rows in tables.items()})


if __name__ == "__main__":
    main()
