"""Small-host regressions: TLS reuse, bounded threads and temporary chat locks."""
import asyncio
import contextlib
import io
from pathlib import Path
import ssl
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from bot import Bot, Config, ServiceError, Store, run, tls_context


class TLSMemoryTests(unittest.TestCase):
    def test_concurrent_first_use_loads_one_certificate_store(self):
        context = object()

        def create(**kwargs):
            time.sleep(0.01)
            return context

        with patch("bot._TLS_CONTEXT", None), patch("bot.ssl.create_default_context", side_effect=create) as factory:
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: tls_context(), range(64)))
            self.assertTrue(all(result is context for result in results))
            self.assertEqual(factory.call_count, 1)

    def test_reused_context_keeps_certificate_and_hostname_checks(self):
        with patch("bot._TLS_CONTEXT", None):
            context = tls_context()
            self.assertIs(context, tls_context())
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)


class RuntimeMemoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "state.sqlite3")
        self.config = Config("123:unused-test-token", data_dir=Path(self.temp.name))

        class API:
            async def send(self, *args, **kwargs):
                pass

        self.bot = Bot(self.config, API(), self.store, object())

    async def asyncTearDown(self):
        await self.bot.shutdown()
        self.store.db.close()
        self.temp.cleanup()

    async def test_finished_visitors_leave_no_chat_locks(self):
        for chat_id in range(200):
            await self.bot.handle({"message": {"chat": {"id": chat_id, "type": "private"}, "text": "/help"}})
        self.assertEqual(len(self.bot.locks), 0)

    async def test_same_chat_stays_serialized_while_lock_is_in_use(self):
        entered, release = asyncio.Event(), asyncio.Event()
        active = peak = calls = 0

        async def process(*args):
            nonlocal active, peak, calls
            active += 1
            calls += 1
            peak = max(peak, active)
            entered.set()
            await release.wait()
            active -= 1

        update = {"message": {"chat": {"id": 42, "type": "private"}, "text": "/help"}}
        with patch.object(self.bot, "process", side_effect=process):
            first = asyncio.create_task(self.bot.handle(update))
            await entered.wait()
            second = asyncio.create_task(self.bot.handle(update))
            await asyncio.sleep(0)
            self.assertEqual(calls, 1)
            release.set()
            await asyncio.gather(first, second)
        self.assertEqual(calls, 2)
        self.assertEqual(peak, 1)
        self.assertEqual(len(self.bot.locks), 0)

    async def test_runtime_bounds_network_threads_under_a_burst(self):
        lock = threading.Lock()
        active = peak = 0

        def network_work():
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.02)
            with lock:
                active -= 1

        class API:
            async def acall(self, method, *args):
                if method == "getMe":
                    return {"username": "test_bot"}
                if method == "getWebhookInfo":
                    return {"url": ""}
                if method == "getUpdates":
                    await asyncio.gather(*(asyncio.to_thread(network_work) for _ in range(12)))
                    raise ServiceError("Telegram", 401)
                return True

        with patch("bot.Telegram", return_value=API()), contextlib.redirect_stdout(io.StringIO()):
            await run(self.config)
        self.assertGreater(peak, 1)
        self.assertLessEqual(peak, 4)


if __name__ == "__main__":
    unittest.main()
