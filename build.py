"""Wrap prototype.html (the Artifact source, which has no document skeleton) into a standalone index.html for GitHub Pages."""
import pathlib

here = pathlib.Path(__file__).parent
body = (here / 'prototype.html').read_text(encoding='utf-8')
body = body.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')

ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E"
        "%3Crect x='6' y='22' width='52' height='36' rx='4' fill='%23C79661'/%3E"
        "%3Crect x='2' y='14' width='60' height='12' rx='3' fill='%239A6E3E'/%3E"
        "%3Crect x='27' y='14' width='10' height='44' fill='%23FFC93A'/%3E%3C/svg%3E")

head = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="挑货、刷卡、等快递、拆箱，一分钱不花。">
<meta name="theme-color" content="#EDF0F6">
<link rel="icon" href="{ICON}">
<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
'''

# The first <style>…</style> and the <title>/<link> lines belong in <head>; the rest is body.
split = body.index('</style>') + len('</style>')
page = head + body[:split] + '\n</head>\n<body>\n' + body[split:].lstrip() + '\n</body>\n</html>\n'
(here / 'index.html').write_text(page, encoding='utf-8')
print('index.html', len(page))
