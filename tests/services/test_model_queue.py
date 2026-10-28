"""Queue admission and model ownership; no trained weights or GPU required."""
import asyncio
import threading
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from services.vision.scheduler import ModelScheduler
from services.vision.runtime import VisionRuntime


class ModelQueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_fifo_failure_recovery_and_bounded_admission(self):
        scheduler = ModelScheduler(max_pending=3, idle_seconds=0)
        entered, finish = threading.Event(), threading.Event()
        events = []
        scheduler.clear_cache = lambda: None
        scheduler.register('vision', lambda: events.append('release-vision'))
        def first():
            entered.set()
            finish.wait(5)
            events.append('first')
        def failed():
            events.append('second')
            raise ValueError('bad job')
        one = asyncio.create_task(scheduler.submit('vision', first))
        await asyncio.to_thread(entered.wait, 5)
        two = asyncio.create_task(scheduler.submit('vision', failed))
        three = asyncio.create_task(scheduler.submit('tools', lambda: events.append('third')))
        await asyncio.sleep(0)
        with self.assertRaises(HTTPException) as error:
            await scheduler.submit('vision', lambda: None)
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(scheduler.status()['pending'], 3)
        finish.set()
        result = await asyncio.gather(one, two, three, return_exceptions=True)
        self.assertIsInstance(result[1], ValueError)
        self.assertEqual([e for e in events if e != 'release-vision'], ['first', 'second', 'third'])
        self.assertEqual(events[1], 'release-vision')
        self.assertIsNone(scheduler.resident)
        self.assertEqual(scheduler.pending, 0)

    async def test_waiting_cancel_does_not_run_and_active_cancel_keeps_ownership(self):
        scheduler = ModelScheduler(idle_seconds=0)
        scheduler.clear_cache = lambda: None
        entered, finish = threading.Event(), threading.Event()
        events = []
        def first():
            entered.set()
            finish.wait(5)
            events.append('first-finished')
        active = asyncio.create_task(scheduler.submit('vision', first))
        await asyncio.to_thread(entered.wait, 5)
        waiting = asyncio.create_task(scheduler.submit('tools', lambda: events.append('cancelled')))
        await asyncio.sleep(0)
        waiting.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiting
        active.cancel()
        next_job = asyncio.create_task(scheduler.submit('vision', lambda: events.append('next')))
        await asyncio.sleep(0.05)
        self.assertEqual(events, [])
        finish.set()
        await asyncio.gather(active, next_job, return_exceptions=True)
        self.assertEqual(events, ['first-finished', 'next'])
        self.assertEqual(scheduler.pending, 0)

    async def test_disconnected_waiter_is_dropped(self):
        scheduler = ModelScheduler(idle_seconds=0)
        scheduler.clear_cache = lambda: None
        class Request:
            async def is_disconnected(self): return True
        with self.assertRaises(HTTPException) as error:
            await scheduler.submit('vision', lambda: self.fail('disconnected job ran'), request=Request())
        self.assertEqual(error.exception.status_code, 499)
        self.assertEqual(scheduler.pending, 0)
        self.assertEqual(await scheduler.submit('vision', lambda: 'okay'), 'okay')


class ModelMemoryTests(unittest.TestCase):
    def test_same_model_reloads_between_jobs_and_failed_work_also_releases_storage(self):
        import torch
        scheduler = ModelScheduler()
        runtime = VisionRuntime()
        scheduler.register('vision', runtime.unload)
        held = []
        def work(fail=False):
            self.assertIsNone(runtime.model)
            self.assertEqual(scheduler.resident, 'vision')
            runtime.model = torch.nn.Linear(16, 8)
            held.append(runtime.model)
            if fail:
                raise ValueError('inference failed')
            return {'finished': True}
        self.assertEqual(scheduler.run('vision', work), {'finished': True})
        self.assertIsNone(runtime.model)
        self.assertIsNone(scheduler.resident)
        self.assertEqual(list(held[0].parameters()), [])
        with self.assertRaises(ValueError): scheduler.run('vision', work, True)
        self.assertIsNone(runtime.model)
        self.assertEqual(list(held[1].parameters()), [])
        self.assertIsNone(scheduler.resident)

    def test_unload_discards_tensor_storage_even_when_a_hook_retains_the_module(self):
        import torch
        runtime = VisionRuntime()
        held_by_hook = torch.nn.Linear(32, 16)
        runtime.model = held_by_hook
        runtime.loaded = 'fixture'
        runtime.unload()
        self.assertEqual(dict(held_by_hook.named_parameters()), {})
        self.assertIsNone(runtime.model)

    def test_idle_release_drops_all_owners_and_vision_switch_clears_allocator(self):
        scheduler = ModelScheduler(idle_seconds=0)
        events = []
        scheduler.clear_cache = lambda: events.append('cache')
        scheduler.register('vision', lambda: events.append('unload'))
        scheduler.resident = 'vision'
        scheduler.release_idle()
        self.assertEqual(events, ['unload', 'cache'])
        self.assertIsNone(scheduler.resident)
        runtime = VisionRuntime()
        runtime.model, runtime.processor, runtime.loaded = object(), object(), 'florence'
        with patch('torch.cuda.is_available', return_value=True), patch('torch.cuda.empty_cache') as clear:
            runtime.unload()
            clear.assert_called_once()
        self.assertIsNone(runtime.model)
        self.assertIsNone(runtime.processor)
        self.assertIsNone(runtime.loaded)
