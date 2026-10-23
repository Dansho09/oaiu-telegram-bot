#!/bin/zsh
cd "${0:A:h}" || exit 1
if [ ! -f .env ]; then
  python3 setup.py || exit 1
fi
python3 bot.py
read -k 1 '?Нажмите любую клавишу, чтобы закрыть окно.'
