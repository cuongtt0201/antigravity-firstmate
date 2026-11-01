echo "== fm.js shape"
B="$T/task one/best"; mkdir -p "$B"
printf 'Brief\n```\ndeliverable: final.md words=20 covers=R1-R2 drafts=draft_*.md\n- deliverable: talk.md words=1.000 covers=R3\n```\n' > "$B/brief.md"
printf '# Kế hoạch\n| --- | --- |\nmột hai ba bốn năm sáu bảy tám chín mười\n## Phần 2\n**Đơn** vị - 2.500 từ\n' > "$B/draft_1.md"
seq 1 30 | tr '\n' ' ' > "$B/draft_2.md"
SHAPE=$(fm shape "$B/brief.md" --sections); RC=$?
check "shape: a draft over the limit exits 1" 1 "$RC"
check "shape: markdown symbols are not words, Vietnamese syllables are" 1 "$(grep -c 'OK     draft_1.md: 18 / 20 words' <<< "$SHAPE")"
check "shape: over by more than 10%" 1 "$(grep -c 'OVER   draft_2.md: 30 / 20' <<< "$SHAPE")"
check "shape: unwritten deliverables are listed" 2 "$(grep -c 'not written yet' <<< "$SHAPE")"
check "shape: limits with a thousands separator" 1 "$(grep -c 'talk.md' <<< "$SHAPE")"
check "shape: words per section" 1 "$(grep -cE '^ +6  ## Phần 2$' <<< "$SHAPE")"
check "shape: one file only" "  OVER   draft_2.md: 30 / 20 words (+50%)" "$(fm shape "$B/brief.md" draft_2.md | grep draft)"
check "shape: one file only, the others are not counted" 0 "$(fm shape "$B/brief.md" --sections draft_1.md >/dev/null; echo $?)"
printf -- '- `deliverable: best/final.md words=20 covers=R1-R2 drafts=best/draft_*.md`\n**deliverable:** **talk.md** words=10\n' > "$B/brief2.md"
SHAPE=$(fm shape "$B/brief2.md")
check "shape: best/ prefixes, backticks and bold are understood" 3 "$(grep -cE 'draft_1.md: 18|draft_2.md: 30|talk.md: not written' <<< "$SHAPE")"
rm "$B/draft_2.md"
fm shape "$B/brief.md" >/dev/null; check "shape: all within limits exits 0" 0 $?
rm "$B/draft_1.md"; check "shape: missing drafts are named" 1 "$(fm shape "$B/brief.md" | grep -c 'draft_\*.md: no drafts yet')"
printf 'no lines\n' > "$B/empty.md"; fm shape "$B/empty.md" >/dev/null 2>&1; check "shape: a brief without deliverable lines is an error" 2 $?
