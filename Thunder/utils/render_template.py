"""Renders the HTML player page from a stored file record."""

import asyncio
import hashlib
import urllib.parse
from pathlib import Path

import minijinja
from pyrogram.errors import FloodWait

from Thunder.bot import StreamBot
from Thunder.server.exceptions import InvalidHash
from Thunder.utils.file_properties import get_fname, get_fsize, get_mime_type, get_uniqid
from Thunder.utils.human_readable import humanbytes
from Thunder.utils.logger import logger
from Thunder.vars import Var

SITE_NAME = "ProXBotz"
CHANNEL_URL = "https://t.me/ProXBotz"

# Module-relative: the bot may be started from any working directory.
TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "template"


def _asset_version() -> str:
    """Content hash of the player assets, for cache-busting query strings."""
    digest = hashlib.sha256()
    for name in ("player.css", "player.js"):
        try:
            digest.update((TEMPLATE_DIR / name).read_bytes())
        except OSError:
            continue
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()

# movi-player demuxes the container itself, so these decide only which surface
# to show, never whether playback is possible.
_VIDEO_EXTENSIONS = frozenset({
    "3g2", "3gp", "asf", "avi", "divx", "f4v", "flv", "m2ts", "m2v", "m4v",
    "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "mxf", "ogv", "rm", "rmvb",
    "ts", "vob", "webm", "wmv",
})
_AUDIO_EXTENSIONS = frozenset({
    "aac", "ac3", "aif", "aiff", "alac", "ape", "dts", "flac", "m4a", "mka",
    "mp3", "ogg", "opus", "wav", "wma",
})
_IMAGE_EXTENSIONS = frozenset({
    "avif", "bmp", "gif", "heic", "heif", "ico", "jpeg", "jpg", "png", "svg",
    "tif", "tiff", "webp",
})

_MEDIA_KINDS = (
    ("video", _VIDEO_EXTENSIONS),
    ("audio", _AUDIO_EXTENSIONS),
    ("image", _IMAGE_EXTENSIONS),
)


def _extension_of(file_name: str) -> str:
    _, dot, ext = (file_name or "").rpartition(".")
    if not dot or "/" in ext or "\\" in ext:
        return ""
    return ext.strip().lower()


def classify_media(file_name: str, mime_type: str) -> str:
    """``video``, ``audio``, ``image`` or ``other`` for the given file.

    The extension wins: Telegram labels a document upload
    ``application/octet-stream`` even when it is an MKV.
    """
    extension = _extension_of(file_name)
    for kind, extensions in _MEDIA_KINDS:
        if extension in extensions:
            return kind

    prefix = (mime_type or "").strip().lower().split("/", 1)[0]
    return prefix if prefix in {"video", "audio", "image"} else "other"


# Unknown variables must raise: there is no contextual autoescaping to fall back on.
template_env = minijinja.Environment(
    loader=minijinja.load_from_path([str(TEMPLATE_DIR)]),
    undefined_behavior="strict",
    keep_trailing_newline=True,
)


async def render_media_page(
    file_name: str,
    stream_url: str,
    *,
    mime_type: str = "application/octet-stream",
    file_size: int = 0,
    page_url: str = "",
) -> str:
    """Render the player page for one file.

    ``stream_url`` must be percent-encoded and carry ``?disposition=inline``; the
    template escapes it (``|tojson`` in the config script, autoescape in markup).
    ``page_url`` is the public address of the page itself, used for sharing.
    """
    normalized = (mime_type or "application/octet-stream").strip().lower()
    download_url = stream_url.split("?", 1)[0]
    kind = classify_media(file_name, normalized)
    extension = _extension_of(file_name)

    return template_env.render_template(
        "req.html",
        file_name=file_name,
        stream_url=stream_url,
        download_url=download_url,
        mime_type=normalized,
        size_formatted=humanbytes(file_size) if file_size else "Unknown",
        is_video=kind == "video",
        is_audio=kind == "audio",
        is_image=kind == "image",
        file_ext=extension.upper() if extension else "FILE",
        # Stable per-file key: the player stores its resume position under it.
        file_key="f2l-" + hashlib.sha256(download_url.encode("utf-8")).hexdigest()[:16],
        page_url=page_url or download_url,
        site_name=SITE_NAME,
        channel_url=CHANNEL_URL,
        asset_version=ASSET_VERSION,
    )


async def render_home_page(
    *,
    uptime_str: str,
    total_clients: int,
    is_multi_client: bool,
    total_active_streams: int,
    clients: list[dict],
) -> str:
    """Render the public status page served at ``/``."""
    return template_env.render_template(
        "home.html",
        uptime_str=uptime_str,
        total_clients=total_clients,
        is_multi_client=is_multi_client,
        total_active_streams=total_active_streams,
        clients=clients,
    )


async def render_page(message_id: int, secure_hash: str) -> str:
    try:
        try:
            message = await StreamBot.get_messages(chat_id=int(Var.BIN_CHANNEL), message_ids=message_id)
        except FloodWait as e:
            await asyncio.sleep(e.value)
            message = await StreamBot.get_messages(chat_id=int(Var.BIN_CHANNEL), message_ids=message_id)

        if not message:
            raise InvalidHash("Message not found")

        file_unique_id = get_uniqid(message)
        file_name = get_fname(message)

        if not file_unique_id or file_unique_id[:6] != secure_hash:
            raise InvalidHash("File unique ID or secure hash mismatch during rendering.")

        quoted_filename = urllib.parse.quote(file_name.replace('/', '_'), safe="")
        src = urllib.parse.urljoin(Var.URL, f'{secure_hash}{message_id}/{quoted_filename}')
        return await render_media_page(
            file_name,
            f"{src}?disposition=inline",
            mime_type=get_mime_type(message),
            file_size=get_fsize(message),
            page_url=urllib.parse.urljoin(Var.URL, f"watch/{secure_hash}{message_id}"),
        )
    except Exception as e:
        logger.error(
            f"Error in render_page for message_id {message_id} and hash {secure_hash}: {e}",
            exc_info=True
        )
        raise
