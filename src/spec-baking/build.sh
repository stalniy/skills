#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$source_dir/../.." && pwd)
target_dir=$repo_root/skills/spec-baking

(cd "$source_dir" && npx --no vite build client)

mkdir -p "$target_dir/client"
rm -rf "$target_dir/agents" "$target_dir/api" "$target_dir/bin" "$target_dir/references" "$target_dir/client/dist"
cp -R "$source_dir/agents" "$source_dir/api" "$source_dir/bin" "$source_dir/references" "$target_dir/"
find "$target_dir/api" -type d -name __pycache__ -prune -exec rm -rf {} +
cp -R "$source_dir/client/dist" "$target_dir/client/"
cp "$source_dir/SKILL.tpl.md" "$target_dir/SKILL.md"
