"""The start/help/about texts must show the bot's own name."""
from types import SimpleNamespace

import pytest

from Thunder.utils.messages import (
    DEFAULT_BOT_NAME,
    MSG_ABOUT,
    MSG_HELP,
    MSG_WELCOME,
    bot_display_name,
)


def test_uses_the_name_telegram_reports():
    client = SimpleNamespace(me=SimpleNamespace(first_name="My Stream Bot"))
    assert bot_display_name(client) == "My Stream Bot"


@pytest.mark.parametrize(
    "client",
    [
        SimpleNamespace(),                                   # not started yet
        SimpleNamespace(me=None),
        SimpleNamespace(me=SimpleNamespace(first_name="")),
        SimpleNamespace(me=SimpleNamespace(first_name=None)),
    ],
)
def test_falls_back_to_the_default_name(client):
    assert bot_display_name(client) == DEFAULT_BOT_NAME


def test_texts_include_the_bot_name():
    welcome = MSG_WELCOME.format(user_name="Sam", bot_name="My Stream Bot")
    help_text = MSG_HELP.format(max_files=5, bot_name="My Stream Bot")
    about = MSG_ABOUT.format(bot_name="My Stream Bot")

    for text in (welcome, help_text, about):
        assert "My Stream Bot" in text
        assert "{bot_name}" not in text
        assert "Thunder" not in text
