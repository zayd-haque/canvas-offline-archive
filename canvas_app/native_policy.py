"""[Codex] Native opening is limited to passive course documents."""
from pathlib import Path

DOCUMENT_EXTENSIONS = frozenset({
    '.pdf', '.txt', '.md', '.csv', '.rtf', '.docx', '.pptx', '.xlsx',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff',
    '.mp3', '.wav', '.m4a', '.mp4', '.mov', '.m4v',
})


def validate_native_action(path, action):
    path = Path(path)
    if action not in {'open', 'reveal'}:
        raise ValueError('Unsupported native action')
    if action == 'reveal':
        return
    if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
        raise PermissionError('Linked paths cannot be opened directly')
    if path.is_dir():
        if path.suffix.lower() in {'.app', '.bundle', '.workflow'}:
            raise PermissionError('Executable bundles cannot be opened')
        return
    if path.suffix.lower() not in DOCUMENT_EXTENSIONS:
        raise PermissionError('This file type must be revealed and opened manually')
