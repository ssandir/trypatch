#!/usr/bin/env bash
# Usage: release-notes.sh <tag> <target commit or branch>
# Shared by prepare-release.yml (PR preview) and release.yml (GitHub Release), so both get the same notes.
set -euo pipefail

args=(-f tag_name="$1" -f target_commitish="$2")
# Only tags reachable from HEAD count, so a maintenance branch like 1.x starts from its own last
# release; left to itself, GitHub would pick main's newer one.
if prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null); then
  args+=(-f previous_tag_name="$prev")
fi
gh api "repos/$GITHUB_REPOSITORY/releases/generate-notes" "${args[@]}" --jq .body
