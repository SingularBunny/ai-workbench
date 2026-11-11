#!/usr/bin/env bash
# Document preview (aiwb-plugins/office) inside the container with the Gateway running: the
# /api/office-preview/convert route behind Gateway auth turns docx into PDF with local LibreOffice;
# not an Office document — 400, no token — 401. The token is a test one, from this container's .env.
echo "==== office"
port=$(openclaw config get gateway.port 2>/dev/null | tr -dc 0-9); port=${port:-18789}
url="http://127.0.0.1:$port/api/office-preview/convert"
token=$(grep -m1 '^OPENCLAW_GATEWAY_TOKEN=' ~/.openclaw/.env | cut -d= -f2-)
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
code() { curl -s -o "$work/out" -w '%{http_code}' "$@"; }
if command -v soffice >/dev/null; then
  printf 'Заметки\n\nПункт 1. Полить сад утром.\n' > "$work/t.txt"
  soffice -env:UserInstallation=file://$work/lo --headless --convert-to docx --outdir "$work" "$work/t.txt" >/dev/null 2>&1
  c=$(code -X POST -H "Authorization: Bearer $token" --data-binary @"$work/t.docx" "$url?name=%D0%97%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8.docx")
  head -c 5 "$work/out" | grep -q '%PDF-'; echo "OFFICE_DOCX_TO_PDF=$? (code $c, $(wc -c < "$work/out") bytes)"
  s=$(date +%s%N); code -X POST -H "Authorization: Bearer $token" --data-binary @"$work/t.docx" "$url?name=t.docx" >/dev/null
  echo "OFFICE_CACHED_MS $(( ($(date +%s%N) - s) / 1000000 ))"
else
  c=$(code -X POST -H "Authorization: Bearer $token" --data-binary 'x' "$url?name=t.docx")
  [[ $c == 503 ]]; echo "OFFICE_NO_LIBREOFFICE_503=$? (code $c)"
fi
c=$(code -X POST -H "Authorization: Bearer $token" --data-binary 'a;b' "$url?name=t.csv"); [[ $c == 400 ]]; echo "OFFICE_REJECTS_NON_OFFICE=$? (code $c)"
c=$(code -X POST --data-binary 'x' "$url?name=t.docx"); [[ $c == 401 ]]; echo "OFFICE_NEEDS_AUTH=$? (code $c)"
c=$(code -H "Authorization: Bearer $token" "$url?name=t.docx"); [[ $c == 405 ]]; echo "OFFICE_POST_ONLY=$? (code $c)"
