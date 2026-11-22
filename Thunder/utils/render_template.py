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

# Module-relative: the bot may be started from any working directory.
TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "template"

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
    """Render the stream page (video/audio) or the download page (everything else).

    ``stream_url`` must be percent-encoded and carry ``?disposition=inline``; the
    templates escape it (``|tojson`` inside scripts, autoescape in markup).
    ``page_url`` is the public address of the page itself (used for sharing).
    """
    normalized = (mime_type or "application/octet-stream").strip().lower()
    download_url = stream_url.split("?", 1)[0]
    kind = classify_media(file_name, normalized)
    is_playable = kind in ("video", "audio")
    extension = _extension_of(file_name)

    return template_env.render_template(
        "watch.html" if is_playable else "dl.html",
        file_name=file_name.replace("_", " "),
        file_name_raw=file_name,
        file_url=stream_url,
        dl_url=download_url,
        watch_url=page_url or download_url,
        file_size=humanbytes(file_size) if file_size else "Unknown",
        # Stable per-file key (the player stores its resume position under it).
        file_unique_id=hashlib.sha256(download_url.encode("utf-8")).hexdigest()[:16],
        file_ext=extension.upper() if extension else "FILE",
        mime_type=normalized,
        media_type=kind,
        is_video=kind == "video",
        is_audio=kind == "audio",
        site_name=SITE_NAME,
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
