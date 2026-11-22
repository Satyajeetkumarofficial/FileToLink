"""Escape and layout checks for the stream and download pages.

MiniJinja has no contextual autoescaping, so the templates depend on |tojson
inside <script> blocks and on attribute autoescaping for markup.
"""
import html
import re
from pathlib import Path

import pytest

from Thunder.utils import render_template

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "Thunder" / "template"

BREAKOUT = 'x" onload="alert(1)</script><script>alert(1)</script>'
URL_WITH_AMPERSAND = "https://example.invalid/f/abc123/clip.mp4?disposition=inline&token=xyz"
PLAYER_PIN = "movi-player@0.4.1"


@pytest.fixture(autouse=True)
def _template_dir(monkeypatch):
    """Resolve templates from the repo, not the process working directory."""
    monkeypatch.setattr(
        render_template.template_env,
        "loader",
        render_template.minijinja.load_from_path([str(TEMPLATE_DIR)]),
    )


def _hrefs(page: str) -> list[str]:
    # The engine writes "/" as &#x2f;, which the browser decodes but Python does not.
    return [html.unescape(h) for h in re.findall(r'href="([^"]+)"', page)]


async def test_video_page_embeds_stream_and_download_urls():
    page = await render_template.render_media_page(
        "clip.mp4", URL_WITH_AMPERSAND, mime_type="video/mp4", file_size=1024
    )

    assert "clip.mp4" in page
    # The stream URL reaches the player script as a JSON string, escaped for JS.
    assert '"https://example.invalid/f/abc123/clip.mp4?disposition=inline\\u0026token=xyz"' in page
    # The download link drops the inline disposition query.
    hrefs = _hrefs(page)
    assert "https://example.invalid/f/abc123/clip.mp4" in hrefs
    assert not any("disposition=inline" in h for h in hrefs), \
        "a download link must not carry the inline disposition"
    assert "1.0 KB" in page


async def test_unknown_size_renders_a_placeholder():
    page = await render_template.render_media_page("clip.mp4", URL_WITH_AMPERSAND, mime_type="video/mp4")
    assert "Unknown" in page


async def test_script_context_does_not_break_out_of_the_script_tag():
    page = await render_template.render_media_page(BREAKOUT, URL_WITH_AMPERSAND, mime_type="video/mp4")

    assert "</script><script>alert(1)" not in page, "filename broke out of the script block"
    assert "\\u003c/script\\u003e" in page, "the filename must reach the script as escaped JSON"


async def test_attribute_context_escapes_quotes_and_angles():
    page = await render_template.render_media_page(BREAKOUT, URL_WITH_AMPERSAND, mime_type="video/mp4")

    assert 'onload="alert(1)' not in page, "filename escaped an attribute"
    title = re.search(r"<title>(.*?)</title>", page, re.S)
    assert title, "title element missing"
    assert "<script>" not in title.group(1)


async def test_video_page_uses_the_movi_player():
    page = await render_template.render_media_page("clip.mkv", URL_WITH_AMPERSAND, mime_type="video/x-matroska")

    assert PLAYER_PIN in page
    assert 'id="videoFrame"' in page
    assert 'id="audioSel"' in page, "audio track selector missing"
    assert 'id="subSel"' in page, "subtitle selector missing"
    assert "<audio" not in page


async def test_audio_page_uses_the_audio_player():
    page = await render_template.render_media_page("song.mp3", URL_WITH_AMPERSAND, mime_type="audio/mpeg")

    assert '<audio id="player"' in page
    assert 'id="videoFrame"' not in page
    assert 'id="audioSel"' not in page


async def test_image_page_renders_the_download_page():
    page = await render_template.render_media_page(
        "photo.jpg", "https://example.invalid/f/abc/photo.jpg", mime_type="image/jpeg"
    )

    assert 'class="cta-download"' in page
    assert 'class="cta-stream"' not in page
    assert PLAYER_PIN not in page


async def test_non_media_page_offers_a_download():
    page = await render_template.render_media_page(
        "doc.pdf", "https://example.invalid/f/abc/doc.pdf", mime_type="application/pdf"
    )

    assert 'class="cta-download"' in page
    assert "doc.pdf" in page
    assert PLAYER_PIN not in page
    assert "https://example.invalid/f/abc/doc.pdf" in _hrefs(page)


@pytest.mark.parametrize(
    "file_name, mime_type, expected",
    [
        # The extension decides, because Telegram labels documents inconsistently.
        ("Fear.Street.1994.480p.WEB-DL.mkv", "application/octet-stream", "video"),
        ("clip.mkv", "application/x-matroska", "video"),
        ("clip.mkv", "", "video"),
        ("clip.MKV", "application/octet-stream", "video"),
        ("clip.ts", "application/octet-stream", "video"),
        ("song.flac", "application/octet-stream", "audio"),
        ("track.mka", "", "audio"),
        ("photo.webp", "application/octet-stream", "image"),
        # No usable extension, so the MIME type decides.
        ("noext", "video/mp4", "video"),
        ("noext", "audio/mpeg", "audio"),
        ("noext", "image/png", "image"),
        ("doc.pdf", "application/pdf", "other"),
        ("archive.zip", "application/zip", "other"),
        ("noext", "application/octet-stream", "other"),
        # A dot that is not an extension must not be read as one.
        ("../etc/passwd", "application/octet-stream", "other"),
        ("file.", "application/octet-stream", "other"),
        ("a.b/c", "application/octet-stream", "other"),
    ],
)
def test_classify_media(file_name, mime_type, expected):
    assert render_template.classify_media(file_name, mime_type) == expected


async def test_octet_stream_mkv_still_gets_the_player():
    """Most real MKV traffic arrives labelled octet-stream."""
    page = await render_template.render_media_page(
        "Fear.Street.1994.480p.WEB-DL.mkv",
        URL_WITH_AMPERSAND,
        mime_type="application/octet-stream",
    )

    assert PLAYER_PIN in page
    assert 'class="cta-download"' not in page


async def test_player_cdn_is_pinned():
    page = await render_template.render_media_page("clip.mp4", URL_WITH_AMPERSAND, mime_type="video/mp4")

    # An unpinned CDN URL would ship releases unreviewed.
    assert PLAYER_PIN in page
    assert "movi-player@latest" not in page
    assert "moviplayer.com/dist" not in page


async def test_pages_carry_no_upstream_branding():
    for name, mime in (("clip.mp4", "video/mp4"), ("doc.pdf", "application/pdf")):
        page = await render_template.render_media_page(name, URL_WITH_AMPERSAND, mime_type=mime)
        assert "ProXBotz" in page
        assert "github.com" not in page.lower()
        assert "fyaz05" not in page.lower()


async def test_page_url_is_used_for_sharing_metadata():
    page = await render_template.render_media_page(
        "clip.mp4", URL_WITH_AMPERSAND, mime_type="video/mp4",
        page_url="https://example.invalid/watch/abc123456",
    )
    assert "https://example.invalid/watch/abc123456" in html.unescape(page)


async def test_unknown_template_variable_fails_loudly():
    """undefined_behavior="strict" must raise, not render an empty slot."""
    with pytest.raises(Exception):
        render_template.template_env.render_template("watch.html", file_name="x")
