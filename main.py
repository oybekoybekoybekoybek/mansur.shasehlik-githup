import asyncio
import html
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Optional, TypedDict

import yt_dlp
from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import FSInputFile, KeyboardButton, Message, ReplyKeyboardMarkup
from shazamio import Shazam

# Agar xohlasangiz tokenni BOT_TOKEN environment variable orqali ham berishingiz mumkin.
BOT_TOKEN = os.getenv("BOT_TOKEN", "8362463941:AAGfggiHQn-91_zFLEc9Qto8xaDl2TjHIew")
DOWNLOAD_ROOT = Path("bot_downloads")
DOWNLOAD_ROOT.mkdir(exist_ok=True)

BTN_SMART = "Smart rejim (Video + Musiqa)"
BTN_VIDEO = "Video yuklab olish"
BTN_MUSIC = "Musiqani topish"
BTN_HELP = "Yordam"

MODE_SMART = "smart"
MODE_VIDEO = "video"
MODE_MUSIC = "music"

INSTAGRAM_LINK_RE = re.compile(
    r"(https?://)?(www\\.)?(instagram\\.com|instagr\\.am)/\\S+",
    flags=re.IGNORECASE,
)

user_modes: dict[int, str] = {}
shazam = Shazam()
dp = Dispatcher()


class TrackInfo(TypedDict):
    title: str
    artist: str
    url: str


def build_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_SMART)],
            [KeyboardButton(text=BTN_VIDEO), KeyboardButton(text=BTN_MUSIC)],
            [KeyboardButton(text=BTN_HELP)],
        ],
        resize_keyboard=True,
        input_field_placeholder="Instagram video link yuboring...",
    )


def extract_instagram_link(text: str) -> Optional[str]:
    match = INSTAGRAM_LINK_RE.search(text)
    if not match:
        return None

    link = match.group(0)
    if not link.startswith("http"):
        link = f"https://{link}"
    return link


def cleanup_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def download_instagram_video(url: str, output_dir: Path) -> tuple[Path, str]:
    ydl_opts = {
        "outtmpl": str(output_dir / "%(id)s.%(ext)s"),
        "format": "mp4/bestvideo+bestaudio/best",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "geo_bypass": True,
        "socket_timeout": 20,
        "retries": 3,
        "cachedir": False,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title") or "Instagram video"
        video_path = Path(ydl.prepare_filename(info))

        if not video_path.exists():
            merged_mp4 = video_path.with_suffix(".mp4")
            if merged_mp4.exists():
                video_path = merged_mp4
            else:
                candidates = sorted(
                    output_dir.glob(f"{video_path.stem}.*"),
                    key=lambda p: p.stat().st_size,
                    reverse=True,
                )
                if not candidates:
                    raise RuntimeError("Video fayl topilmadi.")
                video_path = candidates[0]

    return video_path, title


async def extract_audio_for_search(video_path: Path) -> Path:
    """
    Tezroq va aniqroq topish uchun videodan 40 soniyalik audio preview oladi.
    ffmpeg mavjud bo'lmasa, video faylning o'zini yuboradi.
    """
    preview_audio = video_path.with_suffix(".preview.mp3")
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-y",
            "-ss",
            "00:00:08",
            "-t",
            "00:00:40",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "44100",
            "-b:a",
            "192k",
            str(preview_audio),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        code = await process.wait()
        if code == 0 and preview_audio.exists():
            return preview_audio
    except FileNotFoundError:
        pass

    return video_path


async def identify_song(video_path: Path) -> Optional[TrackInfo]:
    search_file = await extract_audio_for_search(video_path)
    try:
        result = await shazam.recognize(str(search_file))
    except Exception:
        logging.exception("Shazam aniqlashda xatolik")
        return None
    finally:
        if search_file != video_path and search_file.exists():
            search_file.unlink(missing_ok=True)

    if not isinstance(result, dict):
        return None

    track = result.get("track")
    if not track:
        return None

    return {
        "title": track.get("title") or "Noma'lum nom",
        "artist": track.get("subtitle") or "Noma'lum ijrochi",
        "url": track.get("url") or "",
    }


def render_track(track: TrackInfo) -> str:
    lines = [
        "<b>Musiqa topildi:</b>",
        f"Nomi: <b>{html.escape(track['title'])}</b>",
        f"Ijrochi: <b>{html.escape(track['artist'])}</b>",
    ]

    if track["url"]:
        safe_url = html.escape(track["url"], quote=True)
        lines.append(f"Manba: <a href=\"{safe_url}\">Shazam sahifa</a>")

    return "\n".join(lines)


def set_user_mode(message: Message, mode: str) -> None:
    if message.from_user:
        user_modes[message.from_user.id] = mode


def get_user_mode(message: Message) -> str:
    if not message.from_user:
        return MODE_SMART
    return user_modes.get(message.from_user.id, MODE_SMART)


@dp.message(CommandStart())
async def start_handler(message: Message) -> None:
    set_user_mode(message, MODE_SMART)
    text = (
        "Assalomu alaykum!\\n\\n"
        "Bu bot Instagram video havolasi bilan ishlaydi:\\n"
        "1) Video yuklab beradi\\n"
        "2) Videodagi musiqani topib beradi\\n\\n"
        "Menyudan rejim tanlang va Instagram link yuboring."
    )
    await message.answer(text, reply_markup=build_menu())


@dp.message(Command("help"))
@dp.message(F.text == BTN_HELP)
async def help_handler(message: Message) -> None:
    text = (
        "Foydalanish:\\n"
        f"- {BTN_SMART}: video + musiqa natijasi\\n"
        f"- {BTN_VIDEO}: faqat video\\n"
        f"- {BTN_MUSIC}: faqat musiqa\\n\\n"
        "Namuna link: https://www.instagram.com/reel/...\\n"
        "Eslatma: private akkaunt videolari ishlamasligi mumkin."
    )
    await message.answer(text, reply_markup=build_menu())


@dp.message(F.text == BTN_SMART)
async def mode_smart_handler(message: Message) -> None:
    set_user_mode(message, MODE_SMART)
    await message.answer(
        "Smart rejim yoqildi. Endi Instagram link yuboring.",
        reply_markup=build_menu(),
    )


@dp.message(F.text == BTN_VIDEO)
async def mode_video_handler(message: Message) -> None:
    set_user_mode(message, MODE_VIDEO)
    await message.answer(
        "Video rejimi yoqildi. Endi Instagram link yuboring.",
        reply_markup=build_menu(),
    )


@dp.message(F.text == BTN_MUSIC)
async def mode_music_handler(message: Message) -> None:
    set_user_mode(message, MODE_MUSIC)
    await message.answer(
        "Musiqa qidirish rejimi yoqildi. Endi Instagram link yuboring.",
        reply_markup=build_menu(),
    )


@dp.message(F.text)
async def instagram_link_handler(message: Message) -> None:
    text = message.text or ""
    link = extract_instagram_link(text)
    if not link:
        await message.answer(
            "Instagram video link yuboring. Masalan: https://www.instagram.com/reel/...",
            reply_markup=build_menu(),
        )
        return

    mode = get_user_mode(message)
    user_id = message.from_user.id if message.from_user else 0
    task_dir = DOWNLOAD_ROOT / f"{user_id}_{message.message_id}"
    task_dir.mkdir(parents=True, exist_ok=True)

    status = await message.answer("Link qabul qilindi. Ishlayapman...")

    try:
        video_path, title = await asyncio.to_thread(download_instagram_video, link, task_dir)

        if mode in {MODE_VIDEO, MODE_SMART}:
            await status.edit_text("Video yuborilmoqda...")
            await message.answer_video(
                video=FSInputFile(video_path),
                caption=f"Yuklandi: <b>{html.escape(title[:200])}</b>",
            )

        if mode in {MODE_MUSIC, MODE_SMART}:
            await status.edit_text("Musiqa aniqlanmoqda...")
            track = await identify_song(video_path)
            if track:
                await message.answer(render_track(track), disable_web_page_preview=True)
            else:
                await message.answer(
                    "Musiqa topilmadi. Boshqa link yuborib qayta urinib ko'ring."
                )

        await status.delete()

    except Exception:
        logging.exception("Instagram link qayta ishlashda xatolik")
        await status.edit_text(
            "Xatolik yuz berdi. Link public ekanini tekshirib, qayta yuboring."
        )
    finally:
        cleanup_dir(task_dir)


async def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN topilmadi.")

    bot = Bot(
        token=BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    await dp.start_polling(bot)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logging.info("Bot to'xtatildi")
