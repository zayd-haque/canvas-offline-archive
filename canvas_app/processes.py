"""[Codex] Own and reap pipeline process groups, including cancellation races."""
import asyncio
import os
import signal
import subprocess


async def terminate_pipeline_process(proc):
    if proc is None:
        return
    # Concurrent cancel/shutdown/finally paths share one cleanup operation.
    task = getattr(proc, '_canvas_cleanup_task', None)
    if task is None:
        task = asyncio.create_task(_terminate_group(proc))
        proc._canvas_cleanup_task = task
    await asyncio.shield(task)


async def _terminate_group(proc):
    if os.name == 'nt':
        if proc.returncode is None:
            # taskkill /T includes Playwright and downloader children.
            killer = await asyncio.create_subprocess_exec(
                'taskkill', '/PID', str(proc.pid), '/T', '/F',
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            try:
                await asyncio.wait_for(killer.wait(), timeout=10)
            except asyncio.TimeoutError:
                killer.kill()
                await killer.wait()
            # A failed taskkill must not leave shutdown waiting forever.
            if proc.returncode is None:
                try:
                    await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=2)
                except asyncio.TimeoutError:
                    proc.kill()
        await proc.wait()
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=2)
    except asyncio.TimeoutError:
        pass
    finally:
        # Parent exit does not imply its descendants stopped.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    await proc.wait()


async def start_pipeline_process(job, *args, **kwargs):
    if os.name == 'nt':
        kwargs['creationflags'] = kwargs.get('creationflags', 0) | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs['start_new_session'] = True
    spawn = asyncio.create_task(asyncio.create_subprocess_exec(
        *args, **kwargs))
    try:
        proc = await asyncio.shield(spawn)
    except asyncio.CancelledError:
        proc = await spawn
        job['process'] = proc
        await terminate_pipeline_process(proc)
        raise
    job['process'] = proc
    if job.get('cancelled'):
        await terminate_pipeline_process(proc)
    return proc
