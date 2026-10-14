#!/usr/bin/env python3
"""Enter a dedicated Beijing speech key locally; never enables or restarts Chat."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import warnings


def write_config(destination, workspace, api_key):
    if not re.fullmatch(r"ws-[a-z0-9]+", workspace):
        raise ValueError("业务空间 ID 格式不正确。")
    if api_key.strip().startswith("sk-sp-"):
        raise ValueError("不能使用 Token Plan / Coding Plan 套餐密钥。请使用普通百炼 API Key。")
    if not re.fullmatch(r"sk-[A-Za-z0-9_-]{8,256}", api_key):
        raise ValueError("普通 API Key 格式不正确，或包含空白字符。")
    destination = Path(destination)
    if not destination.is_absolute():
        raise ValueError("配置文件必须使用绝对路径。")
    values = {
        "CHAT_SUBTITLES_ENABLED": "false",
        "CHAT_SUBTITLES_BASE_URL": f"https://{workspace}.cn-beijing.maas.aliyuncs.com",
        "CHAT_SUBTITLES_API_KEY": api_key,
        "CHAT_SUBTITLES_MODEL": "qwen3.8-livetranslate-flash-realtime",
    }
    # No shell interpolation, no overwrites, and private from the first write.
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write("".join(f"{key}={json.dumps(value)}\n" for key, value in values.items()))
        output.flush()
        os.fsync(output.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="/etc/originmind-chat/subtitles-provider.env")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.exit(2, "请在服务器交互终端运行；不要通过命令参数、聊天或管道提交密钥。\n")
    try:
        workspace = input("北京地域业务空间 ID（ws- 开头）：").strip()
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            api_key = getpass.getpass("普通百炼 API Key（不回显）：")
        write_config(args.output, workspace, api_key)
    except (ValueError, OSError, EOFError, KeyboardInterrupt, getpass.GetPassWarning) as error:
        message = str(error) if isinstance(error, ValueError) else "未写入配置，请检查文件是否已存在及目录权限。"
        parser.exit(1, message + "\n")
    print("已写入独立 0600 配置文件。尚未启用字幕，未修改聊天密钥、重启或发布。")


if __name__ == "__main__":
    main()
