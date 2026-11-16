#!/bin/sh
# Tells the au12 Arcade SDK where the arcade is (ARCADE_URL), or that there's
# none. Runs at container start, from /docker-entrypoint.d/.
f=/usr/share/nginx/html/arcade.json
url=$(printf '%s' "${ARCADE_URL:-}" | sed -nE 's#^[[:space:]]*(https?://[^/[:space:]]+).*#\1#p')
if [ -n "$url" ]; then
	printf '{ "url": "%s" }\n' "$url" > "$f" && echo "arcade: $url may show this game and receive its scores"
else
	rm -f "$f"
fi
