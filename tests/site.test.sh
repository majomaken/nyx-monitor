#!/usr/bin/env bash
# release/nginx.conf in the release image's own nginx (Docker), serving a tiny site: plain http from Cloudflare goes to
# https, error pages do not name the nginx version, and each path keeps its caching (S3, S5). Files are copied into the
# container, so no bind mount or SELinux label is involved.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
image=$(sed -n 's/^FROM //p' "$here/release/Dockerfile")
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2] want [$3]"; fail=1; fi; }
has() { if grep -qiF -- "$3" <<<"$2"; then echo "ok   $1"; else echo "FAIL $1: [$3] not in [$2]"; fail=1; fi; }

work=$(mktemp -d)
name=nyx-site-test-$$
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
mkdir -p "$work/site/releases"
echo '{}' > "$work/site/latest.json"
echo sig > "$work/site/latest.json.sig"
echo 'echo hi' > "$work/site/get.sh"
echo tar > "$work/site/releases/nyx-monitor-1.0.tar.gz"
echo '<p>hi</p>' > "$work/site/index.html"
docker create --name "$name" -p 127.0.0.1::80 "$image" >/dev/null
docker cp "$here/release/nginx.conf" "$name:/etc/nginx/conf.d/default.conf"
docker cp "$work/site/." "$name:/usr/share/nginx/html/"
docker start "$name" >/dev/null
base=http://127.0.0.1:$(docker port "$name" 80/tcp | head -1 | sed 's/.*://')
for _ in $(seq 100); do curl -fs -o /dev/null "$base/" && break; sleep 0.1; done

code() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$@"; }
check "http from Cloudflare goes to https, path and query kept" \
    "$(code -H 'Host: nyx.example' -H 'CF-Visitor: {"scheme":"http"}' "$base/get.sh?a=1")" "301 https://nyx.example/get.sh?a=1"
check "https from Cloudflare is served" "$(code -H 'CF-Visitor: {"scheme":"https"}' "$base/get.sh")" "200 "
check "a request without CF-Visitor (the proxy's own health checks) is served" "$(code "$base/get.sh")" "200 "
check "a 404 does not name the nginx version" "$(curl -s "$base/nope" | grep -c 'nginx/' || true)" "0"
has "latest.json is not cached" "$(curl -sI "$base/latest.json")" "cache-control: no-cache"
has "its signature is not cached" "$(curl -sI "$base/latest.json.sig")" "cache-control: no-cache"
has "get.sh is not cached" "$(curl -sI "$base/get.sh")" "cache-control: no-cache"
has "a tarball is immutable" "$(curl -sI "$base/releases/nyx-monitor-1.0.tar.gz")" "immutable"
has "every answer says noindex" "$(curl -sI "$base/")" "x-robots-tag: noindex"
exit $fail
