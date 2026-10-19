#!/bin/sh
# Give every script and stylesheet in index.html a fresh ?v= stamp so browsers
# fetch the new files after a release instead of mixing in cached old ones.
# Run before committing a release: sh scripts/stamp-version.sh
cd "$(dirname "$0")/.." || exit 1
v=$(date -u +%Y%m%d%H%M)
sed -i -E "s#((src|href)=\"(js|css)/[^\"?]+)(\?v=[0-9]+)?\"#\1?v=$v\"#g" index.html
grep -c "?v=$v" index.html | xargs echo "stamped assets with v=$v:"
