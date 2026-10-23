import asyncio
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import io

from bot import Bot, Config, Generator, ServiceError, Store, output_budget, parse_delay, request_json, split_text


class FakeAPI:
    def __init__(self):
        self.sent = []
        self.documents = []

    async def send(self, chat_id, text, keyboard=None):
        self.sent.append((chat_id, text, keyboard))

    async def acall(self, *args):
        return True

    async def document(self, chat_id, text):
        self.documents.append((chat_id, text))


class FakeGenerator:
    def __init__(self):
        self.requests = []
        self.error = None
        self.outcomes = []

    def generate(self, messages):
        self.requests.append(messages)
        if self.outcomes:
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        if self.error:
            raise self.error
        return "Құрметті студенттер! OAIU университетіне қош келдіңіздер."


class BotFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "state.db")
        self.api = FakeAPI()
        self.generator = FakeGenerator()
        self.config = Config("123:unused-test-token", "test-key")
        self.bot = Bot(self.config, self.api, self.store, self.generator)

    async def asyncTearDown(self):
        await self.bot.shutdown()
        self.store.db.close()
        self.temp.cleanup()

    async def wizard(self, chat_id=1, settle=True):
        for callback in ("type:speech", "language:kk", "length:3", "tone:warm"):
            await self.bot.process(chat_id, "", callback)
        await self.bot.process(chat_id, "Посвящение в студенты OAIU, выступает преподаватель.", "")
        if settle:
            await self.bot.wait_idle()

    async def test_wizard_generates_requested_language_and_saves(self):
        await self.wizard()
        prompt = self.generator.requests[0][0]["content"]
        self.assertIn("Қазақша", prompt)
        self.assertIn("преподаватель", prompt)
        self.assertEqual(self.store.get(1)["step"], "ready")
        self.assertEqual(len(self.store.drafts(1)), 1)

    async def test_revision_uses_last_result_and_original_facts(self):
        await self.wizard()
        await self.bot.process(1, "Добавь благодарность преподавателям", "")
        await self.bot.wait_idle()
        messages = self.generator.requests[-1]
        self.assertIn("Посвящение", messages[0]["content"])
        self.assertEqual(messages[1]["role"], "assistant")
        self.assertEqual(messages[2]["content"], "Добавь благодарность преподавателям")

    async def test_other_user_cannot_open_draft(self):
        await self.wizard()
        draft_id = self.store.drafts(1)[0][0]
        await self.bot.process(2, "", f"history:{draft_id}")
        self.assertIn("недоступен", self.api.sent[-1][1])
        self.assertNotIn("result", self.store.get(2))

    async def test_history_restores_original_context_not_current_task(self):
        await self.wizard()
        draft_id = self.store.drafts(1)[0][0]
        await self.bot.process(1, "/new", "")
        await self.bot.process(1, "", f"history:{draft_id}")
        self.assertEqual(self.store.get(1)["language"], "kk")
        self.assertIn("Посвящение", self.store.get(1)["brief"])

    async def test_rate_limit_retries_automatically_with_only_loading_and_result(self):
        await self.wizard()
        original = self.store.get(1)["result"]
        self.generator.outcomes = [ServiceError("Groq", 429, 3), "Текст после правки"]
        before = len(self.api.sent)
        clock = [time.time()]
        async def advance(seconds):
            clock[0] += seconds
            await asyncio.sleep(0)
        self.bot.sleep = advance
        with patch("bot.time.time", side_effect=lambda: clock[0]):
            await self.bot.process(1, "Добавь пожелание успеха", "")
            self.assertEqual(self.store.get(1)["result"], original)
            await self.bot.wait_idle()
        self.assertEqual(self.generator.requests[-1][-1]["content"], "Добавь пожелание успеха")
        self.assertEqual(len(self.store.drafts(1)), 2)
        self.assertEqual([item[1] for item in self.api.sent[before:]], ["Готовлю текст…", "Текст после правки"])
        self.assertIsNone(self.store.job(1))

    async def test_shared_pause_waits_silently_for_both_users(self):
        entered, release = asyncio.Event(), asyncio.Event()
        clock = [time.time()]
        async def wait(seconds):
            entered.set()
            await release.wait()
        self.bot.sleep = wait
        with patch("bot.time.time", side_effect=lambda: clock[0]):
            self.store.pause_for(5)
            await self.wizard(1, settle=False)
            await entered.wait()
            await self.wizard(2, settle=False)
            await asyncio.sleep(0)
            self.assertEqual(len(self.generator.requests), 0)
            self.assertEqual([item[1] for item in self.api.sent if item[1].startswith("Готовлю")], ["Готовлю текст…", "Готовлю текст…"])
            clock[0] += 6
            release.set()
            await self.bot.wait_idle()
        self.assertEqual(len(self.generator.requests), 2)
        self.assertFalse(any("Повторить можно" in item[1] for item in self.api.sent))

    async def test_repeated_retry_buttons_do_not_add_jobs_or_loading_messages(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def wait(seconds):
            entered.set()
            await release.wait()
        self.bot.sleep = wait
        self.store.pause_for(60)
        await self.wizard(settle=False)
        await entered.wait()
        for _ in range(3):
            await self.bot.process(1, "", "retry:yes")
        self.assertEqual(sum(text == "Готовлю текст…" for _, text, _ in self.api.sent), 1)
        self.assertEqual(len(self.store.jobs()), 1)
        self.assertEqual(len(self.generator.requests), 0)

    async def test_cancel_works_during_provider_wait(self):
        entered = asyncio.Event()
        async def wait(seconds):
            entered.set()
            await asyncio.Event().wait()
        self.bot.sleep = wait
        self.store.pause_for(60)
        await self.wizard(settle=False)
        await entered.wait()
        await self.bot.process(1, "/cancel", "")
        self.assertIsNone(self.store.job(1))
        self.assertEqual(self.store.get(1)["step"], "type")
        self.assertEqual(len(self.generator.requests), 0)

    async def test_pending_generation_survives_restart_without_repeating_notice(self):
        entered = asyncio.Event()
        async def wait(seconds):
            entered.set()
            await asyncio.Event().wait()
        self.bot.sleep = wait
        self.store.pause_for(60)
        await self.wizard(settle=False)
        await entered.wait()
        await self.bot.shutdown()
        self.assertTrue(self.store.job(1)["notice_sent"])
        self.store.pause_for(0)
        self.bot = Bot(self.config, self.api, self.store, self.generator)
        self.bot.resume_jobs()
        await self.bot.wait_idle()
        self.assertEqual(sum(text == "Готовлю текст…" for _, text, _ in self.api.sent), 1)
        self.assertEqual(len(self.generator.requests), 1)
        self.assertIsNone(self.store.job(1))

    async def test_invalid_key_still_reports_failure_and_keeps_original(self):
        await self.wizard()
        original = self.store.get(1)["result"]
        self.generator.error = ServiceError("Groq", 401)
        await self.bot.process(1, "Добавь приветствие", "")
        await self.bot.wait_idle()
        self.assertEqual(self.store.get(1)["result"], original)
        self.assertIn("API-ключ", self.api.sent[-1][1])
        self.assertIsNone(self.store.job(1))

    async def test_edits_are_buttons_without_extra_instruction_message(self):
        await self.wizard()
        self.assertEqual(self.api.sent[-1][1], self.store.get(1)["result"])
        actions = {button["callback_data"] for row in self.api.sent[-1][2] for button in row}
        self.assertTrue({"edit:thanks", "edit:simple", "edit:custom"}.issubset(actions))
        await self.bot.process(1, "", "edit:thanks")
        await self.bot.wait_idle()
        self.assertIn("благодарность преподавателям", self.generator.requests[-1][-1]["content"])
        await self.bot.process(1, "", "edit:simple")
        await self.bot.wait_idle()
        self.assertIn("менее официальным", self.generator.requests[-1][-1]["content"])

    async def test_custom_edit_button_asks_without_spending_ai_request(self):
        await self.wizard()
        before = len(self.generator.requests)
        await self.bot.process(1, "", "edit:custom")
        self.assertEqual(len(self.generator.requests), before)
        self.assertIn("что изменить", self.api.sent[-1][1])
        await self.bot.process(1, "Добавь приветствие", "")
        await self.bot.wait_idle()
        self.assertEqual(self.generator.requests[-1][-1]["content"], "Добавь приветствие")

    async def test_missing_key_does_not_fake_ai_output(self):
        self.config.groq_key = ""
        await self.wizard()
        self.assertEqual(self.generator.requests, [])
        self.assertIn("GROQ_API_KEY", self.api.sent[-1][1])
        self.assertIn("Посвящение", self.store.get(1)["brief"])

    async def test_private_invite_required(self):
        self.config.access_code = "invitation"
        await self.bot.process(1, "/start", "")
        self.assertIn("приглашению", self.api.sent[-1][1])
        self.assertFalse(self.store.allowed(1))
        await self.bot.process(1, "/start invitation", "")
        self.assertTrue(self.store.allowed(1))
        self.assertIn("Что создадим", self.api.sent[-1][1])

    async def test_group_messages_are_ignored(self):
        await self.bot.handle({"message": {"chat": {"id": -1, "type": "group"}, "text": "/start"}})
        self.assertEqual(self.api.sent, [])

    async def test_export_sends_current_full_text(self):
        await self.wizard()
        await self.bot.process(1, "", "export:txt")
        self.assertEqual(self.api.documents[0], (1, self.store.get(1)["result"]))

    async def test_delete_requires_confirmation_and_only_deletes_own(self):
        await self.wizard(1)
        await self.wizard(2)
        await self.bot.process(1, "/delete", "")
        self.assertTrue(self.store.drafts(1))
        await self.bot.process(1, "", "delete:confirm")
        self.assertEqual(self.store.drafts(1), [])
        self.assertTrue(self.store.drafts(2))

    async def test_stale_language_button_does_not_change_new_task(self):
        await self.bot.process(1, "", "language:en")
        self.assertEqual(self.store.get(1)["step"], "type")


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "state.db")

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_inbox_and_offset_are_persisted_together_and_deduplicated(self):
        update = {"update_id": 77, "message": {"text": "test"}}
        self.store.enqueue([update, update])
        self.assertEqual(self.store.offset(), 78)
        self.assertEqual(self.store.pending(), [(77, update)])
        self.store.done(77)
        self.assertEqual(self.store.pending(), [])

    def test_previous_unfulfilled_request_is_migrated_once(self):
        self.store.put(1, {"brief": "Событие OAIU", "pending_instruction": "Правка", "result": "Старая речь"})
        self.store.migrate_waiting_requests()
        job = self.store.job(1)
        self.assertEqual(job["instruction"], "Правка")
        self.assertEqual(job["session"]["result"], "Старая речь")
        self.store.remove_job(1)
        self.store.migrate_waiting_requests()
        self.assertIsNone(self.store.job(1))

    def test_ready_answer_is_committed_once_and_held_for_delivery(self):
        self.store.save_job(1, {"id": "one", "session": {}, "instruction": None})
        self.assertTrue(self.store.finish_job(1, "one", {"brief": "OAIU"}, "Готовый текст"))
        self.assertEqual(self.store.job(1)["result"], "Готовый текст")
        self.assertEqual(self.store.get(1)["result"], "Готовый текст")
        self.assertEqual(len(self.store.drafts(1)), 1)
        self.assertTrue(self.store.finish_job(1, "one", {"brief": "OAIU"}, "Не дублировать"))
        self.assertEqual(len(self.store.drafts(1)), 1)
        self.assertEqual(self.store.job(1)["result"], "Готовый текст")
        self.store.remove_job(1)
        self.assertFalse(self.store.finish_job(1, "one", {"brief": "OAIU"}, "Другой текст"))
        self.assertEqual(len(self.store.drafts(1)), 1)

    def test_history_is_bounded_per_user(self):
        for i in range(15):
            self.store.add_draft(1, str(i), str(i))
        self.store.add_draft(2, "other", "other")
        rows = self.store.db.execute("SELECT count(*) FROM drafts WHERE chat_id=1").fetchone()
        self.assertEqual(rows[0], 10)
        self.assertEqual(len(self.store.drafts(2)), 1)

    def test_personal_quota_and_expiry(self):
        for _ in range(4):
            self.assertTrue(self.store.quota(1, 100))
        self.assertFalse(self.store.quota(1, 101))
        self.assertTrue(self.store.quota(2, 101))
        self.assertTrue(self.store.quota(1, 162))

    def test_global_quota(self):
        for user in range(20):
            self.assertTrue(self.store.quota(user, 100))
        self.assertFalse(self.store.quota(99, 101))


class ProtocolTests(unittest.TestCase):
    def test_retry_delay_supports_fractional_seconds_and_units(self):
        self.assertEqual(parse_delay("1.432"), 2)
        self.assertEqual(parse_delay("1m26.4s"), 87)
        self.assertEqual(parse_delay("200ms"), 1)
        self.assertEqual(parse_delay("2h3m4s"), 7384)
        self.assertEqual(parse_delay("invalid"), 0)

    def test_budget_matches_requested_output_size(self):
        short = output_budget([{"content": "Формат: 🎤 Речь.\nОбъём: 1 мин"}])
        long = output_budget([{"content": "Формат: 🎤 Речь.\nОбъём: 5 мин"}])
        post = output_budget([{"content": "Формат: 📱 Пост.\nОбъём: 3 мин"}])
        self.assertLess(short, long)
        self.assertLessEqual(post, 1000)

    @patch("urllib.request.urlopen")
    def test_groq_fractional_retry_is_not_replaced_with_sixty_seconds(self, urlopen):
        body = io.BytesIO(json.dumps({"error": {"message": "Rate limit reached on tokens per minute. Please try again in 4.4s."}}).encode())
        urlopen.side_effect = urllib.error.HTTPError("https://example.com", 429, "limit", {"Retry-After": "4.4"}, body)
        with self.assertRaises(ServiceError) as caught:
            request_json("https://example.com", "Groq")
        self.assertEqual(caught.exception.retry_after, 5)
        self.assertEqual(caught.exception.limit_kind, "minute")

    def test_chunking_keeps_emoji_and_full_text_under_utf16_limit(self):
        text = "Привет, OAIU! 🎓\n" * 1000
        chunks = split_text(text)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk.encode("utf-16-le")) // 2 <= 3600 for chunk in chunks))

    @patch("bot.request_json")
    def test_model_output_excludes_thinking(self, request):
        request.return_value = {"choices": [{"message": {"content": "<think>private reasoning</think>Готовая речь"}, "finish_reason": "stop"}]}
        result = Generator(Config("test", "key")).generate([])
        self.assertEqual(result, "Готовая речь")

    @patch("bot.request_json")
    def test_empty_model_answer_is_not_reported_as_success(self, request):
        request.return_value = {"choices": [{"message": {"content": ""}}]}
        with self.assertRaises(ServiceError):
            Generator(Config("test", "key")).generate([])

    @patch("bot.request_json")
    def test_token_limit_is_visible(self, request):
        request.return_value = {"choices": [{"message": {"content": "Речь"}, "finish_reason": "length"}]}
        self.assertIn("Достигнут предел", Generator(Config("test", "key")).generate([]))

    @patch("urllib.request.urlopen")
    def test_error_does_not_leak_token_and_retains_telegram_retry(self, urlopen):
        body = io.BytesIO(json.dumps({"parameters": {"retry_after": 7}}).encode())
        urlopen.side_effect = urllib.error.HTTPError("https://example.com/SECRET", 429, "SECRET", {}, body)
        with self.assertRaises(ServiceError) as caught:
            request_json("https://example.com/SECRET", "Telegram")
        self.assertEqual(caught.exception.retry_after, 7)
        self.assertNotIn("SECRET", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
