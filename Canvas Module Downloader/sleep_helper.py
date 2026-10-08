# sleep_helper.py
# Sleep-safe helper: detects system sleep/wake events and network drops,
# providing auto-pause and resume capabilities across all Canvas scripts.

import time
import socket

def check_internet_connection(host: str = "bruinlearn.ucla.edu", port: int = 443, timeout: float = 3.0) -> bool:
    """Checks if network connectivity to Canvas is active."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect((host, port))
        finally:
            s.close()
        return True
    except Exception:
        return False


def wait_for_network_resume(poll_interval: int = 5, host: str = "bruinlearn.ucla.edu"):
    """Pauses execution if network is lost or laptop is asleep, waiting for Wi-Fi to reconnect."""
    if not check_internet_connection(host=host):
        print(f"\n⏸️ Network disconnected or laptop lid closed. Pausing script execution...")
        while not check_internet_connection(host=host):
            time.sleep(poll_interval)
            print("   ⏳ Waiting for network connection to restore...", end="\r")
        print("\n🌐 Network connection restored! Resuming script execution...\n")
