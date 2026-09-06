#!/bin/sh
launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
printf '%s\n' 'Starting Reference Align. Your browser will open shortly.' 'Keep this window open while you work. Close it when you are finished.'
if [ -x "$launcher_dir/reference-align" ]; then
  exec "$launcher_dir/reference-align" --open "$@"
else
  exec "$launcher_dir/runtime/node" "$launcher_dir/app/server.mjs" --open "$@"
fi
