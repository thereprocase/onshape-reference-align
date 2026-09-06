#!/bin/sh
launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
printf '%s\n' 'Starting Reference Align. Your browser will open shortly.' 'Keep this window open while you work. Close it when you are finished.'
exec "$launcher_dir/reference-align" --open "$@"
