"""One heavy HTTP operation at a time, with explicit model residency handoff."""
import gc
import threading
import asyncio
import sys
from fastapi import HTTPException
from services.model_memory import clear_device_cache


class ModelScheduler:
    def __init__(self, max_pending=4, idle_seconds=0):
        self.lock = threading.Lock()
        self.releases = {}
        self.resident = None
        self.admission = asyncio.Lock()
        self.pending = 0
        self.max_pending = max_pending
        self.idle_seconds = idle_seconds
        self.idle_timer = None

    def status(self):
        result = {'pending': self.pending, 'capacity': self.max_pending,
                'active': self.lock.locked(), 'resident': self.resident,
                'idleUnloadSeconds': self.idle_seconds,
                'unloadAfterJob': self.idle_seconds == 0}
        torch = sys.modules.get('torch')
        if torch and torch.cuda.is_available():
            result['cudaMemory'] = [
                {'device': index,
                 'allocatedMiB': round(torch.cuda.memory_allocated(index) / 1024**2, 1),
                 'reservedMiB': round(torch.cuda.memory_reserved(index) / 1024**2, 1)}
                for index in range(torch.cuda.device_count())
            ]
        return result

    def release_idle(self):
        if not self.lock.acquire(blocking=False):
            return
        try:
            self._release_all()
        finally:
            self.lock.release()

    @staticmethod
    def clear_cache():
        clear_device_cache()

    def _release_all(self):
        for release in self.releases.values():
            release()
        self.resident = None
        self.clear_cache()

    async def submit(self, name, operation, *args, request=None):
        """FIFO admission without holding blocked worker threads or loading more models.

        Disconnected waiting requests are dropped. An already running Torch operation
        finishes before the next slot is granted, even when its HTTP task is cancelled.
        """
        if self.pending >= self.max_pending:
            raise HTTPException(429, 'Local model queue is full. Wait for a job to finish.')
        self.pending += 1
        acquired = False
        waiter = asyncio.create_task(self.admission.acquire())
        try:
            deadline = asyncio.get_running_loop().time() + 600
            while not waiter.done():
                await asyncio.wait({waiter}, timeout=0.2)
                if request and await request.is_disconnected():
                    raise HTTPException(499, 'Queued model request cancelled.')
                if asyncio.get_running_loop().time() >= deadline:
                    raise HTTPException(504, 'Local model queue wait timed out.')
            await waiter
            acquired = True
            if request and await request.is_disconnected():
                raise HTTPException(499, 'Queued model request cancelled.')
            task = asyncio.create_task(asyncio.to_thread(self.run, name, operation, *args))
            try:
                return await asyncio.shield(task)
            except asyncio.CancelledError:
                # Cancelling a Python future cannot interrupt GPU kernels.
                while not task.done():
                    try:
                        await asyncio.shield(task)
                    except asyncio.CancelledError:
                        pass
                if not task.cancelled():
                    task.exception()  # Consume a failed cancelled call before yielding its slot.
                raise
        finally:
            self.pending -= 1
            if not waiter.done():
                waiter.cancel()
                try:
                    await waiter
                except asyncio.CancelledError:
                    pass
            elif not waiter.cancelled() and waiter.exception() is None:
                acquired = True
            if acquired:
                self.admission.release()

    def register(self, name, release):
        self.releases[name] = release

    def run(self, name, operation, *args):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, 'Another local model is working. Please retry shortly.')
        try:
            if self.idle_timer:
                self.idle_timer.cancel()
            if self.resident != name:
                for other, release in self.releases.items():
                    if other != name:
                        release()
                self.clear_cache()
                self.resident = name
            return operation(*args)
        finally:
            try:
                if self.idle_seconds == 0:
                    self._release_all()
                else:
                    self.idle_timer = threading.Timer(self.idle_seconds, self.release_idle)
                    self.idle_timer.daemon = True
                    self.idle_timer.start()
            finally:
                self.lock.release()
