# llm_client.py
# Unified LLM provider interface supporting Google Gemini Flash & local Ollama (Qwen 2.5).

import os
import time
import requests
import threading
import math

# Shared session for HTTP connection pooling (TCP/TLS keep-alive)
_session = requests.Session()


# [Codex] Every Gemini attempt shares this process-wide gate, including retries
# and calls from knowledge generation, classification, and folder sorting.
_gemini_pace_lock = threading.Lock()
_gemini_next_start = 0.0


def _wait_gemini_slot(config):
    global _gemini_next_start
    tier = str(config.get('gemini_tier', 'free')).strip().lower()
    is_paid = (tier == 'paid')

    if is_paid:
        default_rpm = 120.0
        max_rpm = 600.0
    else:
        default_rpm = 10.0
        max_rpm = 12.0  # Headroom below the user's 15 RPM quota.

    try:
        raw_rpm = config.get('gemini_requests_per_minute')
        rpm = float(raw_rpm) if raw_rpm is not None else default_rpm
        if not math.isfinite(rpm) or rpm <= 0:
            rpm = default_rpm
    except (TypeError, ValueError):
        rpm = default_rpm

    rpm = min(rpm, max_rpm)
    with _gemini_pace_lock:
        wait = max(0, _gemini_next_start - time.monotonic())
        if wait:
            tier_label = " (paid tier)" if is_paid else ""
            print(f'   Gemini pacing{tier_label}: waiting {wait:.1f}s (target {rpm:g} requests/min).', flush=True)
            time.sleep(wait)
        _gemini_next_start = time.monotonic() + 60 / rpm + 0.05


def _gemini_cooldown(response, data):
    """Respect server hints, with at least one full minute for a 429."""
    waits = [60.0]
    try:
        value = response.headers.get('Retry-After')
        if isinstance(value, str):
            try:
                waits.append(float(value))
            except ValueError:
                from email.utils import parsedate_to_datetime
                waits.append(parsedate_to_datetime(value).timestamp() - time.time())
    except (ValueError, TypeError, OverflowError):
        pass
    error = data.get('error', {}) if isinstance(data, dict) else {}
    details = error.get('details', []) if isinstance(error, dict) else []
    if isinstance(details, list):
        for detail in details:
            if isinstance(detail, dict) and str(detail.get('@type', '')).endswith('/google.rpc.RetryInfo'):
                value = detail.get('retryDelay')
                try:
                    if isinstance(value, str) and value.endswith('s'):
                        waits.append(float(value[:-1]))
                except ValueError:
                    pass
    return max(wait for wait in waits if math.isfinite(wait))


def is_ollama_online(ollama_url: str) -> bool:
    """Fast non-blocking check (<0.3s) to verify if local Ollama server is active."""
    try:
        base_url = ollama_url.rsplit("/api/", 1)[0]
        res = _session.get(base_url, timeout=0.3)
        return res.status_code == 200
    except Exception:
        return False


def get_available_ollama_models(ollama_url: str) -> list:
    """Fetches list of model names currently installed in local Ollama."""
    try:
        base_url = ollama_url.rsplit("/api/", 1)[0]
        res = _session.get(f"{base_url}/api/tags", timeout=0.8)
        if res.status_code == 200:
            data = res.json()
            return [m.get("name", "") for m in data.get("models", [])]
    except Exception:
        pass
    return []


def get_system_hardware_profile() -> dict:
    """Detects CPU architecture, chip model, total RAM in GB, and returns hardware profile & tier."""
    import platform
    import subprocess

    total_ram_gb = 16.0
    try:
        total_ram_gb = (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) / (1024 ** 3)
    except Exception:
        if os.name == 'nt':
            try:
                import ctypes

                class MemoryStatus(ctypes.Structure):
                    _fields_ = [('length', ctypes.c_ulong), ('memory_load', ctypes.c_ulong),
                                ('total_physical', ctypes.c_ulonglong), ('available_physical', ctypes.c_ulonglong),
                                ('total_page_file', ctypes.c_ulonglong), ('available_page_file', ctypes.c_ulonglong),
                                ('total_virtual', ctypes.c_ulonglong), ('available_virtual', ctypes.c_ulonglong),
                                ('available_extended_virtual', ctypes.c_ulonglong)]

                status = MemoryStatus()
                status.length = ctypes.sizeof(status)
                if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                    total_ram_gb = status.total_physical / (1024 ** 3)
            except (OSError, AttributeError):
                pass

    chip_name = platform.processor() or platform.machine()
    is_apple_silicon = False
    device_model = "Mac" if platform.system() == "Darwin" else platform.system()
    is_fanless = False

    if platform.system() == "Darwin":
        try:
            brand = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
            if brand:
                chip_name = brand
        except Exception:
            pass
        if "Apple" in chip_name or platform.machine() == "arm64":
            is_apple_silicon = True

        # Detect specific Mac hardware model (e.g. MacBook Air vs MacBook Pro)
        try:
            hw_model = subprocess.check_output(["sysctl", "-n", "hw.model"], text=True).strip()
        except Exception:
            hw_model = ""

        try:
            sp_out = subprocess.check_output(["system_profiler", "SPHardwareDataType"], text=True)
            for line in sp_out.splitlines():
                if "Model Name:" in line:
                    device_model = line.split(":", 1)[1].strip()
                    break
        except Exception:
            if "MacBookAir" in hw_model:
                device_model = "MacBook Air"
            elif "MacBookPro" in hw_model:
                device_model = "MacBook Pro"

        # MacBook Air and 12" Retina MacBooks are 100% fanless (passive thermal dissipation)
        if "air" in device_model.lower() or "air" in hw_model.lower() or device_model == "MacBook":
            is_fanless = True

    # Hardware tier:
    # 'low': <12 GB RAM, or non-Apple Silicon / Intel Mac with <=16GB RAM
    # 'mid': 12-16 GB RAM (e.g. 12GB, 14GB budget configs)
    # 'high': >=16 GB RAM (e.g. 16GB, 18GB M3 Pro, 24GB, 36GB+, heavy workstations)
    if total_ram_gb < 12.0 or (platform.system() == "Darwin" and not is_apple_silicon):
        tier = "low"
    elif total_ram_gb < 16.0:
        tier = "mid"
    else:
        tier = "high"

    return {
        "ram_gb": round(total_ram_gb, 1),
        "chip": chip_name,
        "is_apple_silicon": is_apple_silicon,
        "tier": tier,
        "device_model": device_model,
        "is_fanless": is_fanless
    }


def get_hardware_recommendations(profile: dict = None, has_gemini_key: bool = False) -> dict:
    """Returns model and provider recommendations tailored to the host's hardware profile."""
    if profile is None:
        profile = get_system_hardware_profile()

    tier = profile.get("tier", "high")
    ram_gb = profile.get("ram_gb", 16.0)
    chip = profile.get("chip", "Unknown")
    is_fanless = profile.get("is_fanless", False)
    device_model = profile.get("device_model", "Computer")

    # Fanless laptops (e.g. MacBook Air): Regardless of RAM, sustained 7B inference will heat the chassis & throttle
    if is_fanless:
        rec_local = "qwen2.5:3b"
        rec_provider = "gemini" if has_gemini_key else "ollama"
        reason = (
            f"Detected fanless {device_model} with {ram_gb} GB RAM ({chip}). "
            f"Because this machine has no internal cooling fans, Google Gemini Flash Lite or 'qwen2.5:3b' (~2GB RAM) is "
            f"strongly recommended to prevent aluminum chassis heating and severe thermal throttling. 'qwen2.5:7b' is supported but will warm up the chassis."
        )
    elif tier == "low":
        rec_local = "qwen2.5:3b"
        rec_provider = "gemini" if has_gemini_key else "ollama"
        reason = (
            f"Detected {ram_gb} GB RAM ({chip}). Local 7B/8B models require >=16GB RAM and will cause high fan noise, "
            f"thermal throttling, and system swapping. Google Gemini Cloud AI is strongly recommended."
        )
    elif tier == "mid":
        rec_local = "qwen2.5:7b"
        rec_provider = "gemini" if has_gemini_key else "ollama"
        reason = (
            f"Detected {ram_gb} GB RAM ({chip}). 'qwen2.5:7b' (~4.8GB RAM) is recommended for near-Gemini accuracy, "
            f"while 'qwen2.5:3b' (~2GB RAM) is available if you prefer a lower-power option."
        )
    else:
        rec_local = "qwen2.5:7b"
        rec_provider = "ollama"
        reason = (
            f"Detected {ram_gb} GB RAM ({chip}). Excellent hardware for local AI. "
            f"'qwen2.5:7b' is strongly recommended for maximum classification accuracy and near-Gemini reasoning."
        )

    return {
        "profile": profile,
        "recommended_local_model": rec_local,
        "recommended_provider": rec_provider,
        "reason": reason
    }


def resolve_ollama_model(config: dict, ollama_url: str) -> str:
    """Resolves the best available Ollama model.
    Prioritizes hardware-tailored Qwen 2.5 models based on Mac/PC specs.
    Seamlessly adapts to any installed Qwen variant or local model if target is not yet pulled."""
    configured_model = config.get("ollama_model", "").strip()

    if configured_model and configured_model != "auto":
        return configured_model  # [Codex] Explicit model selection is never substituted.
    else:
        # Hardware-aware auto-selection based on Mac RAM
        total_ram_gb = get_system_hardware_profile()['ram_gb']
        target = "qwen2.5:7b" if total_ram_gb >= 16.0 else "qwen2.5:3b"

    installed = get_available_ollama_models(ollama_url)
    if not installed:
        return target

    # Pass 1: Exact match on full model:tag (e.g. qwen2.5:3b matches qwen2.5:3b)
    for m in installed:
        m_lower = m.lower()
        if m_lower == target.lower() or m_lower.startswith(f"{target.lower()}:"):
            return m

    # Pass 2: Base family match if target had no specific tag or tag wasn't found
    target_clean = target.lower().split(":")[0]
    for m in installed:
        m_lower = m.lower()
        if m_lower.split(":")[0] == target_clean:
            return m

    # Fallback to any installed Qwen model
    qwen_models = [m for m in installed if "qwen" in m.lower()]
    if qwen_models:
        return qwen_models[0]

    # Fallback to whatever model is installed locally
    return installed[0]


class ProviderError(RuntimeError):
    """[Codex] Selected provider failed; never switch providers implicitly."""


def query_llm(prompt: str, config: dict, timeout: int = 25, as_json: bool = False, num_ctx: int = None) -> str:
    """Queries either Google Gemini API or local Ollama based on config['llm_provider']."""
    provider = config.get("llm_provider", "gemini").lower()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip() or config.get("gemini_api_key", "").strip()
    gemini_model = config.get("gemini_model", "gemini-flash-lite-latest").strip()
    ollama_url = config.get("ollama_url", "http://localhost:11434/api/generate")

    if provider == 'rules':
        return ''
    if provider not in {'gemini', 'ollama'}:
        raise ProviderError(f'Unsupported AI provider: {provider}')
    if provider == 'gemini' and not gemini_key:
        raise ProviderError('Gemini is selected but its API key is missing. No fallback was attempted.')

    if provider == 'ollama':
        from urllib.parse import urlparse
        endpoint = urlparse(ollama_url)
        if endpoint.scheme not in {'http', 'https'} or endpoint.hostname not in {'localhost', '127.0.0.1', '::1'} or endpoint.username or endpoint.password:
            raise ProviderError('Local Ollama requires a loopback endpoint without embedded credentials.')

    # Provider 1: Google Gemini API
    if provider == "gemini" and gemini_key:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
        headers = {"Content-Type": "application/json", "x-goog-api-key": gemini_key}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        if as_json:
            payload["generationConfig"] = {"responseMimeType": "application/json"}

        # [Codex] Log bounded metadata only, never prompts, raw responses, or URLs.
        def label(value):
            import re
            if not isinstance(value, str) or gemini_key in value:
                return 'unknown'
            return value if re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', value) else 'unknown'

        reasons = []
        for attempt in range(1, 4):
            delay = 0
            status = None
            try:
                _wait_gemini_slot(config)
                res = _session.post(url, json=payload, headers=headers, timeout=timeout)
                status = res.status_code
                if status == 200:
                    data = res.json()
                    if not isinstance(data, dict):
                        raise ValueError('Invalid response shape')
                    candidates = data.get('candidates') or []
                    candidate = candidates[0] if candidates and isinstance(candidates[0], dict) else {}
                    content = candidate.get('content') or {}
                    parts = content.get('parts') or []
                    text = ''.join(part['text'] for part in parts
                                   if isinstance(part, dict) and isinstance(part.get('text'), str)
                                   and not part.get('thought')).strip()
                    if text:
                        return text
                    feedback = data.get('promptFeedback') or {}
                    reason = ('HTTP 200 with no usable text; finish_reason=' + label(candidate.get('finishReason'))
                              + '; block_reason=' + label(feedback.get('blockReason')))
                    delay = 1
                else:
                    hints = {401: 'authentication failed', 402: 'billing/payment required',
                             403: 'permission denied', 429: 'quota/rate limit',
                             500: 'server error', 503: 'service unavailable'}
                    reason = f'HTTP {status}: {hints.get(status, "request rejected")}'
                    data = {}
                    try:
                        data = res.json()
                        error = data.get('error', {}) if isinstance(data, dict) else {}
                        if isinstance(error, dict) and error.get('status'):
                            reason += '; api_status=' + label(error['status'])
                    except (ValueError, TypeError):
                        pass
                    if status == 429:
                        delay = _gemini_cooldown(res, data)
                        if delay > 300:
                            reason += f'; server requests {delay:g}s cooldown; retry this job later'
                            delay = 0
                    elif status == 503:
                        delay = 4 * attempt
            except Exception as exc:
                # Exception strings can contain the API-key-bearing request URL.
                kind = type(exc).__name__
                import requests
                if isinstance(exc, requests.exceptions.Timeout):
                    kind = 'timeout'
                elif isinstance(exc, requests.exceptions.ConnectionError):
                    kind = 'connection error'
                elif isinstance(exc, (ValueError, TypeError, AttributeError, KeyError)):
                    kind = 'invalid response'
                else:
                    kind = 'request error'
                reason = f'HTTP {status}; {kind}' if status is not None else kind
                delay = 2
            reasons.append(f'attempt {attempt}/3: {reason}')
            retry = attempt < 3 and delay > 0
            action = f'retrying in {delay}s' if retry else 'stopping'
            print(f'   ⚠️ Gemini {reasons[-1]}; {action}.', flush=True)
            if not retry:
                break
            time.sleep(delay)
        raise ProviderError('Gemini failed (' + ' | '.join(reasons) + '). No fallback was attempted.') from None

    # Provider 2: Local Ollama
    elif not is_ollama_online(ollama_url):
        raise ProviderError('Ollama is selected but unavailable. Start Ollama and retry; no fallback was attempted.')

    model = resolve_ollama_model(config, ollama_url)
    if num_ctx is None:
        num_ctx = config.get("num_ctx", 4096)

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "num_ctx": num_ctx,
            "num_gpu": 99,
            "temperature": 0.1,
            "top_p": 0.9
        }
    }
    if as_json:
        payload["format"] = "json"

    try:
        res = _session.post(ollama_url, json=payload, timeout=timeout)
        if res.status_code == 200:
            text = res.json().get("response", "").strip()
            if text:
                return text
        else:
            print(f"   ⚠️ Ollama HTTP {res.status_code}: request rejected.")
    except Exception as e:
        print("   ⚠️ Local Ollama request failed.")

    raise ProviderError('Ollama request failed. No fallback was attempted.')
