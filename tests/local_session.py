"""[Codex] Authenticate synthetic ASGI test clients through the real endpoint."""
_COOKIES = {}


async def session_cookie(server, request):
    access = server.LOCAL_ACCESS
    if access not in _COOKIES:
        status, headers, _ = await request('/api/auth/session', method='POST',
            headers={'origin': 'http://127.0.0.1:8000'},
            body={'token': access.bootstrap_token}, _bootstrap=True)
        if status != 204:
            raise AssertionError(f'Synthetic browser bootstrap failed: {status}')
        _COOKIES[access] = headers[b'set-cookie'].decode().split(';', 1)[0]
    return _COOKIES[access]
