# firstmate v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa firstmate từ v0.12 (App, Argon là agent chính) lên v1.0: chạy trên Antigravity IDE, System 1 (Flash) điều phối, System 2 (Argon) chỉ được gọi để duyệt; nhiều crew Flash làm song song trong worktree ngoài repo; tự merge theo mức rủi ro, có `undo` và ledger.

**Architecture:** Giữ khung hiện tại (hooks `guard.js`/`inject.js` + script `fm.js`, chỉ dùng Node). Tách các module nhỏ: paths, config, lock, risk, detect, usage, các gói policy, platform adapter, brief parser. Các việc không phụ thuộc IDE làm trước (Phase 1), song song với khảo sát IDE (Phase 0). Mọi việc phụ thuộc IDE chờ kết quả Phase 0.

**Tech Stack:** Node ≥ 22.13 (`node:sqlite`), git worktree, bash test harness (`tests/run.sh`), GitHub Actions trên 3 hệ điều hành; vendor duy nhất là `js-yaml`.

**Spec:** [docs/superpowers/specs/2026-11-01-firstmate-v1-design.md](../specs/2026-11-01-firstmate-v1-design.md)

## Global Constraints

- Node ≥ 22.13; không thêm dependency npm. Script runtime chỉ dùng Node (không bash, không ruby), chạy được trên macOS, Linux, Windows.
- `bash tests/run.sh` phải pass trên CI (ubuntu, macos, windows). Baseline v0.12: `passed: 227  failed: 0`. Mỗi task chỉ tăng số test; không task nào được làm giảm số test pass.
- Test không bao giờ chạm `~/.gemini` hay `~/.firstmate` thật. Dùng `FM_STATE_DIR`, `FM_CONVO_DB`, `FM_BRAIN_DIR`, và hai biến mới `FM_HOME` (mặc định `~/.firstmate`), `FM_WT_ROOT` (mặc định `$FM_HOME/wt`).
- Hook fail open. Nhưng lỗi trong code phụ (ghi state, log) không được biến một quyết định deny thành allow; giữ nguyên tắc của `saveState`.
- Hook chạy trong timeout 5 giây. Không gọi lệnh git nặng trong hook.
- Bất biến giữ nguyên:
  - agent không `git push`;
  - không đổi hệ thống đang chạy (gói `devops`);
  - crew không tự ghi `.firstmate/notes/*`, `facts.md`, `config.json`, `ledger.tsv`, verdict, `refs/firstmate/*`. Chỉ `fm.js` được ghi.
- Prompt và docs trong repo viết bằng tiếng Anh; agent trả lời bằng ngôn ngữ của captain.
- Commit trong lúc phát triển theo mẫu `dev: <việc>`; bản phát hành theo mẫu `v1.0.0: <tóm tắt>`. Mọi commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Mã thoát của `fm.js`: `0` xong, `1` gate FAIL hoặc conflict, `2` lỗi hoặc từ chối, `3` đã đề xuất nhưng chưa áp dụng (chờ captain).

## Review Focus

1. **Sandbox của IDE không cho ghi ra ngoài workspace** (`~/.firstmate/wt`). Mong đợi: `fm.js start` báo lỗi rõ ràng và gợi ý `FM_WT_ROOT`, không để worker thất bại âm thầm. Test ở Task 1.3.
2. **Captain sửa cùng file trong lúc task chạy, hoặc sau khi đã merge.** Mong đợi: `deliver` từ chối (đã có), `undo` từ chối và không làm mất dòng của captain. Test ở Task 1.6.
3. **Hai chat, hoặc hai lệnh `fm.js` song song, trên cùng một repo.** Mong đợi: không trùng workspace, không trùng slot. Test ở Task 1.3.
4. **Chế độ `commit` gặp pre-commit hook fail** (husky, lint-staged). Mong đợi: thay đổi vẫn được áp dụng dưới dạng chưa commit, báo rõ lý do, ledger ghi `apply`. Test ở Task 1.6.
5. **Đường dẫn kiểu Windows** (`C:\…\.firstmate\wt\…`, `src\auth\x.ts`, cú pháp `set X=… &&` của cmd). Mong đợi: nhận đúng workspace, mức rủi ro và secret. Test ở Task 1.3, 1.5, 1.8.

## Thứ tự và phụ thuộc

```
Phase 0: 1.1 ─► 0.1 ─► 0.2 ─► 0.3 ───────────────────┐
Phase 1: 1.1 ─► 1.2, 1.9 (độc lập)                   │
         1.1 ─► 1.3 ─► 1.4 ─► 1.5 ─► 1.6 ─► 1.7      │
                       1.4 ─► 1.8                    ▼
Phase 2 (adapter IDE) ◄────────────────────── kết quả Phase 0
Phase 3 (vai trò S1/S2) ◄─ Phase 2
Phase 4 (chất lượng) ◄─ Phase 3, 1.6, 1.7
Phase 5 (tự chủ) ◄─ Phase 4
Phase 6 (phát hành) ◄─ tất cả
```

Phase 0 và Phase 1 được viết chi tiết đến từng bước. Phase 2–5 được viết ở mức task: file, interface, danh sách test. Sau Phase 0, mỗi phase này sẽ có một plan chi tiết riêng (`docs/superpowers/plans/2026-11-xx-firstmate-v1-phase-N.md`), vì các tên, payload và đường dẫn thật của IDE có thể làm đổi interface.

---

## Phase 0 — Khảo sát Antigravity IDE

Mục tiêu: trả lời Q1–Q9 bằng bằng chứng (log), rồi chọn Plan A, B hoặc C (spec 3.10).

| # | Câu hỏi |
|---|---|
| Q1 | IDE nạp plugin từ đâu: `~/.gemini/config/plugins/<name>` (định dạng như App) hay `~/.gemini/antigravity-ide/plugins/<publisher.name>`? Manifest cần những gì? |
| Q2 | Có những hook nào (`PreToolUse`, `SessionStart`, `PreInvocation`)? Payload có các trường gì? Có tôn trọng `deny`, `force_ask`, `overwrite`, `injectSteps` không? |
| Q3 | Agent trong IDE có `invoke_subagent`, `send_message`, `manage_subagents` không? Subagent chạy nền và báo kết quả về chứ? |
| Q4 | Tham số `Model` của subagent nhận giá trị nào (`flash`, `flash-lite`, `argon`, model khác họ)? |
| Q5 | Tham số `Workspace` nhận giá trị nào? IDE có tự tạo worktree cho từng subagent không? Đặt ở đâu, có tạo branch không? |
| Q6 | Lấy tên agent và chat cha ở đâu (`~/.gemini/antigravity-ide/conversations/<id>.db`: schema)? Transcript ở `brain/<id>/.system_generated/logs/transcript.jsonl` có cùng định dạng với App không? |
| Q7 | `modelName` thật trong payload của từng model; IDE có những model nào cho agent chính và cho subagent? |
| Q8 | Sandbox: subagent có ghi được vào `~/.firstmate/wt/...` không, với Terminal Sandbox bật và tắt? |
| Q9 | Tên các tool trong IDE (`view_file`, `write_to_file`…); subagent có thấy `<skills>` của các plugin khi `inheritCustomizations: true` không? |

### Task 0.1: Plugin thăm dò

Làm sau Task 1.1 (cần bộ test đã tách).

**Files:**
- Create: `tools/probe/plugin/plugin.json`, `tools/probe/plugin/hooks.json`, `tools/probe/plugin/agents/probe-main.md`, `tools/probe/plugin/agents/probe-sub.md`, `tools/probe/probe.js`, `tools/probe/install.js`
- Test: `tests/05-probe.sh`

**Interfaces:**
- Produces:
  - `node tools/probe/probe.js <event>`: đọc payload JSON từ stdin, nối thêm một dòng `{"t":<iso>,"event":"<event>","payload":<json>}` vào `$FM_PROBE_LOG` (mặc định `~/.firstmate-probe/log.jsonl`). Trả về `{}`, trừ khi payload chứa marker:
    - `PROBE_DENY` → trả `{"decision":"deny","reason":"probe deny"}`;
    - `PROBE_ASK` → `{"decision":"force_ask","reason":"probe ask"}`;
    - `invoke_subagent` có `TypeName` là `probe-sub` → `{"decision":"allow","overwrite":{"Model":"<$FM_PROBE_MODEL>"}}`.
  - `node tools/probe/install.js --target <plugins-dir> [--uninstall]`: chép `tools/probe/plugin` vào `<plugins-dir>/fm-probe` và điền `{{PROBE_DIR}}`, `{{NODE}}`.
  - `hooks.json` đăng ký `probe.js` cho mọi sự kiện mà v0.12 dùng (`PreToolUse`, `SessionStart`, `PreInvocation`), cộng `PostToolUse` và `Stop` để thử.
  - `probe-main`: agent chính, có đủ tool như `firstmate` v0.12. `probe-sub`: subagent, `inheritCustomizations: true`, `inheritMcp: true`, `model: flash`.

- [ ] **Step 1: Write the failing test** (`tests/05-probe.sh`)
```bash
echo "== probe plugin"
PL="$T/probe.log"
printf '{"conversationId":"c1","toolCall":{"name":"run_command","args":{"CommandLine":"ls"}}}' | FM_PROBE_LOG="$PL" node "$ROOT/tools/probe/probe.js" PreToolUse > "$T/probe.out"
check "probe: logs one line" 1 "$(wc -l < "$PL" | tr -d ' ')"
check "probe: answers {} by default" '{}' "$(cat "$T/probe.out")"
check "probe: deny marker" deny "$(printf '{"toolCall":{"name":"run_command","args":{"CommandLine":"echo PROBE_DENY"}}}' | FM_PROBE_LOG="$PL" node "$ROOT/tools/probe/probe.js" PreToolUse | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))')"
node "$ROOT/tools/probe/install.js" --target "$T/plugins" >/dev/null
check "probe: install fills paths" 0 "$(grep -c '{{' "$T/plugins/fm-probe/hooks.json")"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: FAIL vì chưa có `tools/probe/probe.js`.
- [ ] **Step 3:** Viết `probe.js` và `install.js` theo Interfaces; viết manifest và agent theo đúng định dạng của `plugin/` v0.12.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: `failed: 0`, số pass tăng đúng 4 so với trước task.
- [ ] **Step 5:** Commit `dev: probe plugin for the Antigravity IDE survey`.

### Task 0.2: Chạy khảo sát trong IDE (người thực hiện: captain, có Claude hỗ trợ đọc log)

**Files:**
- Create: `docs/ide-capabilities.md` (mỗi câu Q1–Q9: câu trả lời, trích log làm bằng chứng, phiên bản IDE)

- [ ] **Step 1:** Cài probe vào cả hai vị trí:
```bash
node tools/probe/install.js --target ~/.gemini/config/plugins
```
```bash
node tools/probe/install.js --target ~/.gemini/antigravity-ide/plugins
```
  Bật plugin trong `~/.gemini/config/config.json` (`plugins.fm-probe.enabled = true`), rồi khởi động lại Antigravity IDE. Ghi lại: plugin hiện trong Customizations không, nạp từ vị trí nào (Q1).
- [ ] **Step 2:** Mở một repo git, chọn agent `probe-main`, gửi `hello`. Trong `~/.firstmate-probe/log.jsonl` phải có `SessionStart` và `PreInvocation`; chép danh sách trường của payload (Q2, Q7).
- [ ] **Step 3:** Gửi `run: ls` rồi `run: echo PROBE_DENY` rồi `run: echo PROBE_ASK`. Ghi lại: lệnh thứ hai có bị chặn không, lệnh thứ ba có hỏi không (Q2). Ghi lại tên tool từ log (Q9).
- [ ] **Step 4:** Gửi `invoke two probe-sub subagents in parallel, Workspace "inherit", each runs pwd and reports`. Lặp lại với `FM_PROBE_MODEL` lần lượt là `flash`, `flash-lite`, `argon`, và một model khác họ nếu có trong picker. Ghi lại: model nào được nhận (`modelName` trong log của subagent), subagent có chạy nền và báo về không (Q3, Q4).
- [ ] **Step 5:** Lặp lại Step 4 với `Workspace` bằng mọi giá trị mà schema của tool cho phép (xem log `PreToolUse` của `invoke_subagent`). Ghi lại thư mục và branch subagent được cấp (Q5).
- [ ] **Step 6:** Bảo `probe-sub` ghi file `~/.firstmate/wt/probe-test/x.txt`, một lần với Terminal Sandbox bật, một lần tắt (Q8).
- [ ] **Step 7:** Bảo `probe-sub` liệt kê `<skills>` mà nó thấy (Q9). Mở `~/.gemini/antigravity-ide/conversations/<id>.db` của chat chính và của subagent bằng `node -e "const {DatabaseSync}=require('node:sqlite');…"`, chép schema các bảng và vị trí của tên agent và chat cha (Q6).
- [ ] **Step 8:** Gỡ probe:
```bash
node tools/probe/install.js --target ~/.gemini/config/plugins --uninstall
```
```bash
node tools/probe/install.js --target ~/.gemini/antigravity-ide/plugins --uninstall
```
  Commit `docs/ide-capabilities.md` với message `dev: Antigravity IDE capability survey`.

### Task 0.3: Chốt quyết định

**Files:**
- Create: `docs/v1-decisions.md`: Plan A/B/C, kèm câu trả lời D1–D7 của captain (spec mục 5) và giá trị thật cho `models.fast|standard|strong`.

- [ ] **Step 1:** Áp cây quyết định của spec 3.10 vào `docs/ide-capabilities.md`.
- [ ] **Step 2:** Captain chốt D1–D7; ghi lại.
- [ ] **Step 3:** Viết plan chi tiết cho Phase 2 dựa trên các quyết định này; commit `dev: v1 platform decisions`.

---

## Phase 1 — Nền móng không phụ thuộc IDE

### Task 1.1: Tách bộ test theo phần

**Files:**
- Create: `tests/lib.sh`: các dòng 6–26 hiện tại (thiết lập `T`, biến môi trường, `fm`, `ok`, `bad`, `check`, `guard`, `cmdjson`, `invoke`, `used`). Thêm `export FM_HOME="$T/fmhome"`.
- Create: `tests/10-guard.sh` (dòng 28–130), `tests/20-budget.sh` (132–185), `tests/30-hooks.sh` (187–208), `tests/40-shape.sh` (210–230), `tests/50-workspace.sh` (232–267 và 307–309), `tests/60-review.sh` (269–305)
- Modify: `tests/run.sh`: chỉ còn `source tests/lib.sh`, `for f in "$ROOT"/tests/[0-9]*.sh; do source "$f"; done`, in tổng và trả mã thoát

**Interfaces:**
- Produces: các file test sau này đặt tên `tests/NN-<area>.sh` và được `source` theo thứ tự tên; dùng chung các helper trong `tests/lib.sh`.

- [ ] **Step 1:** Chạy `bash tests/run.sh` trên nhánh hiện tại. Mong đợi: `passed: 227  failed: 0`.
- [ ] **Step 2:** Tách file như trên, không đổi nội dung test nào.
- [ ] **Step 3:** Chạy `bash tests/run.sh`. Mong đợi: `passed: 227  failed: 0`, đúng các tiêu đề `== …` theo thứ tự cũ.
- [ ] **Step 4:** Commit `dev: split the test suite by area`.

### Task 1.2: `fm.js usage`: đo token theo chat

**Files:**
- Create: `plugin/scripts/fm-usage.js`
- Create: `tests/fixtures/usage/brain/p1/.system_generated/logs/transcript.jsonl`, `tests/fixtures/usage/brain/c1/.system_generated/logs/transcript.jsonl`, `tests/fixtures/usage/state/models.log`
- Modify: `plugin/scripts/fm.js` (thêm lệnh `usage`)
- Test: `tests/70-usage.sh`

**Interfaces:**
- Produces:
  - `usage(id: string, { brainDirs: string[], modelsLog: string }) -> { rows: Array<{ id, role: 'main'|'sub', model, calls, newIn, cacheRead, out }>, share: { newIn: number, cacheRead: number, out: number } }`. `share` là phần trăm (làm tròn xuống) của các dòng có model "mạnh", tức model không khớp `/flash/i`; model không rõ thì tính là mạnh nếu `role` là `main`.
  - Subagent con được tìm bằng cách quét các bước `GENERIC` của transcript cha để lấy `"conversationId": "<id>"`.
  - `fm.js usage <conversation-id> [--brain <dir>]…`. Thư mục brain mặc định: `$FM_BRAIN_DIR` nếu có; nếu không thì `~/.gemini/antigravity/brain`, `~/.gemini/antigravity-ide/brain`, `~/.gemini/antigravity-cli/brain`. `models.log` lấy từ `$FM_STATE_DIR`.
  - Mỗi dòng in ra có dạng `<id> <role> <model> calls=<n> new_in=<n> cache=<n> out=<n>`; dòng cuối là `strong share: new_in <p>%, cache <p>%, out <p>%`.

- [ ] **Step 1: Write the fixtures and the failing test**
  - Transcript `p1`: `USER_INPUT`; `PLANNER_RESPONSE` (`input_tokens` 1000, `cache_read_tokens` 0, `output_tokens` 100, gọi `invoke_subagent`); `GENERIC` chứa `"conversationId": "c1"`; `PLANNER_RESPONSE` (200, 800, 50); thêm một dòng không phải JSON.
  - Transcript `c1`: `PLANNER_RESPONSE` (500, 500, 200) và (300, 1200, 100).
  - `models.log`: `2026-11-01T00:00:00Z p1 gemini-4-argon-medium` và `2026-11-01T00:00:01Z c1 gemini-3.8-flash-tiered`.
```bash
echo "== fm.js usage"
U=$(FM_BRAIN_DIR="$ROOT/tests/fixtures/usage/brain" FM_STATE_DIR="$ROOT/tests/fixtures/usage/state" fm usage p1)
check "usage: main row" 1 "$(grep -c '^p1 main gemini-4-argon-medium calls=2 new_in=1200 cache=800 out=150$' <<< "$U")"
check "usage: child found from the parent transcript" 1 "$(grep -c '^c1 sub gemini-3.8-flash-tiered calls=2 new_in=800 cache=1700 out=300$' <<< "$U")"
check "usage: strong share" "strong share: new_in 60%, cache 32%, out 33%" "$(tail -1 <<< "$U")"
check "usage: unknown chat is an error" 2 "$(FM_BRAIN_DIR="$T/none" fm usage nope >/dev/null 2>&1; echo $?)"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check `usage:` FAIL (`unknown command 'usage'`).
- [ ] **Step 3:** Viết `fm-usage.js` theo Interfaces; nối lệnh `usage` vào `main()` của `fm.js`.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết.
- [ ] **Step 5:** Chạy `node plugin/scripts/fm.js usage fb1da927-f940-4d2c-b940-0add60749b35` trên máy captain. Ghi các con số vào `docs/benchmarks.md` dưới mục "Baseline v0.12 (chat thật)". Mong đợi: phần của Argon khớp với số trong spec 1.4 (47/53/56%).
- [ ] **Step 6:** Commit `dev: fm.js usage reports tokens per agent and the strong-model share`.

### Task 1.3: Workspace v2: worktree ngoài repo, slot, khoá, dọn dẹp

**Files:**
- Create: `plugin/scripts/fm-paths.js`, `plugin/scripts/fm-lock.js`
- Modify: `plugin/scripts/fm.js` (`start`, `save`, `gate`, `deliver`, `review`, `status`, `clean`; thêm `path`, `sweep`, `clean --legacy`)
- Modify: `plugin/hooks/guard.js` (`sharedTask` → `workspaceKey`)
- Modify: `tests/lib.sh` (thêm `export FM_WT_ROOT="$T/wt"`); `tests/50-workspace.sh`, `tests/60-review.sh` (chỗ nào ghép tay `$R/.firstmate/wt/<t>` thì đổi sang `$(fm path "$R" <t>)`); `tests/10-guard.sh`

**Interfaces:**
- Produces (`fm-paths.js`):
  - `fmHome() -> string`: `$FM_HOME` hoặc `~/.firstmate`.
  - `wtRoot() -> string`: `$FM_WT_ROOT` hoặc `<fmHome>/wt`.
  - `repoKey(repo: string) -> string`: `<tên thư mục, chỉ giữ [A-Za-z0-9._-]>-<8 ký tự hex đầu của sha1(realpath(repo))>`.
  - `taskDir(repo: string, task: string) -> string`: `<repo>/.firstmate/wt/<task>` nếu thư mục đó đã tồn tại (task cũ của v0.12); nếu không thì `<wtRoot>/<repoKey>/<task>`.
  - `notesDir(repo) -> string`.
  - `repoOfWorkspace(dir: string) -> { repo: string, task: string } | null`: đi ngược lên tới thư mục có file `.git` (không phải thư mục), đọc dòng `gitdir:` để tìm repo chính; `task` là tên thư mục workspace.
- Produces (`fm-lock.js`): `withLock(repo: string, fn: () => T) -> T`. Khoá bằng `mkdirSync(<repo>/.firstmate/.lock)`, thử lại tối đa 5 giây, mỗi lần nghỉ 50ms. Khoá cũ hơn 60 giây coi là chết và được gỡ. Hết giờ thì `die('another firstmate command holds the lock on <repo>')`.
- Produces (`fm.js`):
  - `fm.js path <repo> <task>`: in ra `taskDir`.
  - Slot: `start` ghi `<notes>/<task>.slot` là số nguyên nhỏ nhất chưa dùng (trong khoá). `save` và `gate` cập nhật mtime của file này. Khi task bị xoá (`deliver`, `clean`, `sweep`), file slot cũng bị xoá. Task cũ không có file slot thì lấy tuổi theo mtime của thư mục workspace. `gate` chạy lệnh check với `FIRSTMATE_SLOT=<n>` và `PORT=<portBase + n>`; `portBase` mặc định 3100 (Task 1.4 sẽ đọc từ cấu hình).
  - `start` khi không tạo được `wtRoot` thì thoát mã 2 với thông báo nêu rõ `FM_WT_ROOT`.
  - `fm.js sweep <repo> [--hours N] [--yes]`: liệt kê các task có mtime của file slot cũ hơn N giờ (mặc định 24), hoặc có workspace đã mất. Có `--yes` mới xoá (giống `clean`).
  - `fm.js clean <repo> --legacy [--yes] [--force]`: liệt kê branch `subagent-*` và các worktree đăng ký dưới `~/.gemini/antigravity*/worktrees/` (kèm branch của chúng). `--yes` xoá những branch đã merge vào HEAD. `--force` xoá cả branch chưa merge.
  - Mọi lệnh ghi (`start`, `deliver`, `clean`, `sweep`) chạy trong `withLock`.
- Produces (`guard.js`): `workspaceKey(prompt: string) -> string`. Lấy phần sau `.firstmate/wt/` (chấp nhận cả `\`). Nếu đoạn đầu khớp `^[A-Za-z0-9._-]+-[0-9a-f]{8}$` thì trả `<repoKey>/<task>`, ngược lại trả `<task>`. So sánh không phân biệt hoa thường.

- [ ] **Step 1: Write the failing tests** (thêm vào cuối `tests/50-workspace.sh` và vào `tests/10-guard.sh`)
```bash
fm clean "$R" --all >/dev/null   # task f1 (giữ lại từ test trước) không được chiếm slot 0
fm start "$R" t2 >/dev/null
check "workspace lives outside the repo" yes "$(case "$(fm path "$R" t2)" in "$FM_WT_ROOT"/*) echo yes;; *) echo no;; esac)"
check "no in-repo workspace for new tasks" no "$([ -d "$R/.firstmate/wt/t2" ] && echo yes || echo no)"
fm start "$R" t3 >/dev/null
check "slots are distinct" "0 1" "$(cat "$R/.firstmate/notes/t2.slot" "$R/.firstmate/notes/t3.slot" | tr '\n' ' ' | sed 's/ $//')"
check "gate passes FIRSTMATE_SLOT and PORT" 0 "$(fm gate "$R" t3 'node -e "process.exit(process.env.FIRSTMATE_SLOT===\"1\"&&process.env.PORT===\"3101\"?0:1)"' >/dev/null 2>&1; echo $?)"
git -C "$R" worktree add -q --detach "$R/.firstmate/wt/old1" HEAD && git -C "$R" update-ref refs/firstmate/old1/base HEAD && git -C "$R" update-ref refs/firstmate/old1/head HEAD
check "a v0.12 in-repo task still resolves" "$R/.firstmate/wt/old1" "$(fm path "$R" old1)"
for i in 1 2 3 4; do fm start "$R" race >/dev/null 2>&1 & done; wait
check "concurrent starts of one task make one workspace" 1 "$(git -C "$R" worktree list | grep -c '[/\\]race ')"
if [ -z "$WIN" ]; then
  mkdir -p "$T/ro"; chmod 555 "$T/ro"
  check "unwritable workspace root: exit 2 naming FM_WT_ROOT" "2 1" "$(FM_WT_ROOT="$T/ro/wt" fm start "$R" nowrite > "$T/nw.out" 2>&1; echo "$? $(grep -c FM_WT_ROOT "$T/nw.out")")"
fi
touch -t 202001010000 "$R/.firstmate/notes/t2.slot"
check "sweep lists an old task (dry run)" 1 "$(fm sweep "$R" | grep -c 't2')"
check "...and keeps it" 1 "$(fm status "$R" | grep -c 't2 |')"
fm sweep "$R" --yes >/dev/null
check "sweep --yes removes only the old task" "0 1" "$(fm status "$R" | grep -c 't2 |') $(fm status "$R" | grep -c 't3 |')"
git -C "$R" branch subagent-merged main
git -C "$R" checkout -q -b subagent-unmerged && git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x && git -C "$R" checkout -q ft/x
check "clean --legacy lists both, deletes nothing" "2 2" "$(fm clean "$R" --legacy | grep -c 'subagent-') $(git -C "$R" branch --list 'subagent-*' | wc -l | tr -d ' ')"
fm clean "$R" --legacy --yes >/dev/null
check "clean --legacy --yes deletes only merged branches" subagent-unmerged "$(git -C "$R" branch --list 'subagent-*' --format='%(refname:short)')"
fm clean "$R" --legacy --yes --force >/dev/null
check "--force deletes unmerged too" "" "$(git -C "$R" branch --list 'subagent-*' --format='%(refname:short)')"
```
```bash
# tests/10-guard.sh
twonew() { node -e 'const p=(t)=>"Task workspace: "+process.argv[1]+"/.firstmate/wt/myrepo-1a2b3c4d/"+t+"/src";process.stdout.write(JSON.stringify({conversationId:"two2",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"worker",Prompt:p(process.argv[2])},{TypeName:"worker",Prompt:p(process.argv[3])}]}}}))' "$1" "$2" "$3" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))'; }
check "two workers in one new-style workspace are refused" deny "$(twonew /home/u infra infra)"
check "different new-style workspaces are fine" allow "$(twonew /home/u infra-tf infra-docs)"
check "Windows-style workspace paths are compared" deny "$(twonew 'C:\Users\u' infra INFRA)"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check mới FAIL (chưa có `fm.js path`, `sweep`; workspace vẫn nằm trong repo).
- [ ] **Step 3:** Viết `fm-paths.js` và `fm-lock.js`. Trong `fm.js`, đổi mọi chỗ ghép `path.join(r, '.firstmate', 'wt', t)` sang `taskDir(r, t)`; thêm slot, `path`, `sweep`, `clean --legacy`, khoá. Trong `guard.js`, thay `sharedTask` bằng `workspaceKey`.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết, kể cả 227 check cũ (sau khi đổi sang `fm path`).
- [ ] **Step 5:** Commit `dev: workspaces outside the repo, slots, a repo lock, sweep and legacy clean-up`.

### Task 1.4: Cấu hình: `.firstmate/config.json` và `$FM_HOME/config.json`

**Files:**
- Create: `plugin/scripts/fm-config.js`
- Modify: `plugin/scripts/fm.js` (lệnh `config`; `gate` đọc `portBase`); `plugin/hooks/guard.js` (`RECORD_RE` có thêm `config.json`)
- Test: `tests/55-config.sh`

**Interfaces:**
- Produces:
  - `DEFAULTS = { merge: 'apply', protectedBranches: ['main','master','release/*'], commitOnProtected: false, checks: {}, checkTimeoutSec: 600, portBase: 3100, packs: ['core','devops'], models: { fast: 'flash', standard: 'flash', strong: 'argon' }, caps: { perCall: 6, crewPerDay: 40, judgePerDay: 15 }, autoMergeMaxRisk: 'medium', handoffAtTokens: 150000 }`. `merge` để `apply` cho tới Phase 5; Phase 5 mới đổi theo D2, khi đã có judge và risk gate.
  - `loadConfig(repo?: string) -> Config`: `DEFAULTS` ← `$FM_HOME/config.json` ← `<repo>/.firstmate/config.json`. Ghi đè từng khoá cấp đầu; riêng `checks`, `models`, `caps` thì gộp thêm một cấp.
  - `setRepoConfig(repo: string, key: string, value: string) -> void`: `key` có thể dùng dấu chấm (`checks.test`). `value` được parse JSON nếu hợp lệ, không thì giữ là chuỗi.
  - `fm.js config <repo> [key [value]]`: không có `key` thì in toàn bộ cấu hình đã gộp (JSON). Có `key` thì in giá trị (mảng nối bằng dấu phẩy). Có `value` thì ghi vào cấu hình repo.

- [ ] **Step 1: Write the failing test**
```bash
echo "== config"
check "config default merge" apply "$(fm config "$R" merge)"
fm config "$R" checks.test "npm test" >/dev/null
check "config set nested" "npm test" "$(fm config "$R" checks.test)"
mkdir -p "$FM_HOME"; printf '{"packs":["core"],"portBase":4000}' > "$FM_HOME/config.json"
check "global config is read" core "$(fm config "$R" packs)"
fm config "$R" packs '["core","devops"]' >/dev/null
check "repo config overrides global" core,devops "$(fm config "$R" packs)"
check "config file stays out of git" "" "$(git -C "$R" status --porcelain --ignored=no .firstmate)"
check "crew may not edit config.json" deny "$(guard wk write_to_file '{"TargetFile":"/r/.firstmate/config.json"}')"
rm "$FM_HOME/config.json"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check `config` FAIL.
- [ ] **Step 3:** Viết `fm-config.js`, lệnh `config`, và mở rộng `RECORD_RE`.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết.
- [ ] **Step 5:** Commit `dev: per-repo and global config`.

### Task 1.5: `fm.js risk`: phân loại rủi ro tất định

**Files:**
- Create: `plugin/scripts/fm-risk.js`
- Modify: `plugin/scripts/fm.js` (lệnh `risk`; ghi `<notes>/<t>.risk`)
- Test: `tests/57-risk.sh`

**Interfaces:**
- Produces:
  - `classify({ files: Array<{ path: string, status: 'A'|'M'|'D'|'R' }>, changedLines: number }) -> { level: 'low'|'medium'|'high', reasons: string[] }`. Trước khi so khớp, `path` được đổi `\` thành `/`.
  - **high** khi có bất kỳ điều kiện nào sau:
    - auth: `/(^|\/)(auth|authn|authz|security|crypto|permissions?|acl|iam|oauth|session)s?(\/|\.|_|-)/i`
    - migration: `/(^|\/)(migrations?|migrate|alembic|flyway|liquibase)\//i` hoặc `\.sql$`
    - CI: `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines`, `.circleci/`
    - hạ tầng: `.tf`, `.tfvars`, `.hcl`, `Chart.yaml`, `values*.yaml`, thư mục `k8s|kubernetes|helm|deploy|manifests`, `Dockerfile*`, `docker-compose*.yml`
    - lockfile và dependency: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `Pipfile.lock`, `go.mod`, `go.sum`, `Cargo.lock`, `Gemfile.lock`, `composer.lock`, `requirements*.txt`
    - secret: `.env*`, tên chứa `secret|credential|password`, đuôi `.pem|.key|.p12|.pfx`
    - status `D`
    - `changedLines > 400`
  - **medium** khi không có điều kiện high nào và: `changedLines > 150`, hoặc hơn 5 file, hoặc có file nằm ngoài nhóm low.
  - **low**: chỉ gồm docs (`.md|.mdx|.txt|.rst|.adoc`, thư mục `doc|docs|documentation`) và test (thư mục `test|tests|__tests__|spec`, `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.go|py`).
  - `fm.js risk <repo> <task>` in `RISK: <level>`, sau đó mỗi lý do một dòng `- <reason>`, đồng thời ghi `<level>` vào `<notes>/<task>.risk`. Mã thoát 0.

- [ ] **Step 1: Write the failing test**
```bash
echo "== risk"
risk() { node -e 'const {classify}=require(process.argv[1]);process.stdout.write(classify(JSON.parse(process.argv[2])).level)' "$P/scripts/fm-risk.js" "$1"; }
f() { printf '{"files":[{"path":"%s","status":"%s"}],"changedLines":%s}' "$1" "$2" "$3"; }
check "risk: docs only" low "$(risk "$(f docs/a.md M 3)")"
check "risk: test only" low "$(risk "$(f src/a.test.ts M 10)")"
check "risk: small code change" medium "$(risk "$(f src/a.ts M 10)")"
check "risk: migration" high "$(risk "$(f db/migrations/001_init.sql A 5)")"
check "risk: deleted file" high "$(risk "$(f src/old.ts D 5)")"
check "risk: CI" high "$(risk "$(f .github/workflows/ci.yml M 2)")"
check "risk: auth path" high "$(risk "$(f src/auth/login.ts M 2)")"
check "risk: lockfile" high "$(risk "$(f package-lock.json M 2)")"
check "risk: big diff" high "$(risk "$(f src/a.ts M 401)")"
check "risk: Windows path" high "$(risk "$(f 'src\\auth\\login.ts' M 2)")"
check "risk: six doc files" medium "$(risk '{"files":[{"path":"a.md","status":"M"},{"path":"b.md","status":"M"},{"path":"c.md","status":"M"},{"path":"d.md","status":"M"},{"path":"e.md","status":"M"},{"path":"f.md","status":"M"}],"changedLines":12}')"
fm start "$R" rk1 >/dev/null; RW=$(fm path "$R" rk1); rm -f "$RW/conflict.txt"; fm save "$R" rk1 x >/dev/null
check "fm risk on a task that deletes a file" "RISK: high" "$(fm risk "$R" rk1 | head -1)"
check "risk is recorded" high "$(cat "$R/.firstmate/notes/rk1.risk")"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check `risk` FAIL.
- [ ] **Step 3:** Viết `fm-risk.js` theo Interfaces. `fm risk` lấy danh sách file và status từ `git diff --name-status base head`, số dòng đổi từ `git diff --numstat`.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết.
- [ ] **Step 5:** Commit `dev: deterministic risk levels for a task`.

### Task 1.6: `deliver` theo chế độ, `undo`, ledger

**Files:**
- Modify: `plugin/scripts/fm.js` (`deliver`; thêm `undo`)
- Test: `tests/58-deliver.sh`

**Interfaces:**
- Consumes: `loadConfig` (1.4), `classify` (1.5), `withLock`/`taskDir` (1.3).
- Produces:
  - `fm.js deliver <repo> <task> [--keep] [--approve] [--mode propose|apply|commit] [--message "<subject>"]`:
    - Chế độ lấy từ `--mode`, không có thì từ `config.merge`.
    - Rủi ro `high` mà không có `--approve` thì chạy như `propose`.
    - `propose`: in `[fm] PROPOSED task <t> (risk <level>): waiting for the captain` cùng diff stat, giữ task, **thoát mã 3**.
    - `apply`: như v0.12, thêm lưu `<notes>/<t>.patch` (giữ lại kể cả khi task đã bị xoá).
    - `commit`: áp dụng, rồi `git add -- <files>` và `git commit -m "<subject|firstmate: <t>>" -m "Firstmate-Task: <t>\nFirstmate-Risk: <level>"` bằng identity của repo (nếu repo không có identity thì dùng identity `firstmate` của v0.12).
      - Nếu branch hiện tại khớp `protectedBranches` và `commitOnProtected` là false: lùi về `apply`, in `[fm] <branch> is protected: applied, not committed`.
      - Nếu commit thất bại (ví dụ pre-commit hook): `git reset -q -- <files>`, in `[fm] commit failed (<dòng lỗi đầu tiên>); the change is applied, uncommitted`, ledger ghi `apply`.
  - Ledger `<notes>/ledger.tsv`, có dòng header `time	task	mode	risk	gate	verdict	files	sha	undone`. Mỗi lần deliver không phải propose thêm một dòng; `verdict` để `-` cho tới Phase 4. `undo` sửa đúng dòng đó (ghi lại file), không thêm dòng mới.
  - `fm.js undo <repo> <task>`: lấy dòng ledger cuối của task mà `undone` còn trống.
    - `commit`: `git revert --no-edit <sha>`. Từ chối nếu sha không phải tổ tiên của HEAD.
    - `apply`: `git apply -R --check <patch>` rồi `git apply -R`. Nếu check fail thì thoát mã 2 với `[fm] <files> changed since the delivery; undo by hand`.
    - Thành công thì ghi thời điểm vào cột `undone`.

- [ ] **Step 1: Write the failing test**
```bash
echo "== deliver modes, undo, ledger"
D="$T/dl"; mkdir -p "$D/docs" "$D/src"; (cd "$D" && git init -q -b main && echo a > docs/a.md && echo 'x' > src/a.js && echo k > keep.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm base && git checkout -q -b feat)
git -C "$D" config user.name t; git -C "$D" config user.email t@t
fm init "$D" >/dev/null
mk() { fm start "$D" "$1" >/dev/null; printf "$3" > "$(fm path "$D" "$1")/$2"; fm save "$D" "$1" x >/dev/null; fm gate "$D" "$1" >/dev/null 2>&1; }
L="$D/.firstmate/notes/ledger.tsv"
fm config "$D" merge apply >/dev/null; mk a1 docs/a.md 'b\n'; fm deliver "$D" a1 >/dev/null 2>&1
check "apply: change is uncommitted" 1 "$(git -C "$D" status --porcelain | wc -l | tr -d ' ')"
check "apply: ledger row" apply "$(tail -1 "$L" | cut -f3)"
fm undo "$D" a1 >/dev/null 2>&1
check "undo apply: tree clean again" "" "$(git -C "$D" status --porcelain)"
check "undo is marked in the ledger" yes "$([ -n "$(tail -1 "$L" | cut -f9)" ] && echo yes)"
fm config "$D" merge commit >/dev/null; N=$(git -C "$D" rev-list --count HEAD); mk c2 docs/a.md 'c\n'; fm deliver "$D" c2 >/dev/null 2>&1
check "commit: one new commit with the task trailer" "$((N + 1)) 1" "$(git -C "$D" rev-list --count HEAD) $(git -C "$D" log -1 --format=%B | grep -c '^Firstmate-Task: c2$')"
check "commit: tree clean" "" "$(git -C "$D" status --porcelain)"
fm undo "$D" c2 >/dev/null 2>&1
check "undo commit makes a revert commit" 1 "$(git -C "$D" log -1 --format=%s | grep -c '^Revert')"
git -C "$D" checkout -q main; mk p3 docs/a.md 'p\n'; fm deliver "$D" p3 >/dev/null 2>&1
check "protected branch: applied, not committed" apply "$(tail -1 "$L" | cut -f3)"
git -C "$D" checkout -q -- . ; git -C "$D" checkout -q feat
fm config "$D" merge propose >/dev/null; mk q4 docs/a.md 'q\n'; fm deliver "$D" q4 >/dev/null 2>&1
check "propose exits 3, tree untouched, task kept" "3  1" "$(fm deliver "$D" q4 >/dev/null 2>&1; echo $?) $(git -C "$D" status --porcelain) $(fm status "$D" | grep -c 'q4 |')"
fm clean "$D" q4 >/dev/null; fm config "$D" merge commit >/dev/null
fm start "$D" h5 >/dev/null; rm "$(fm path "$D" h5)/keep.txt"; fm save "$D" h5 x >/dev/null; fm gate "$D" h5 >/dev/null 2>&1
check "high risk waits for the captain" 3 "$(fm deliver "$D" h5 >/dev/null 2>&1; echo $?)"
check "--approve delivers it" 0 "$(fm deliver "$D" h5 --approve >/dev/null 2>&1; echo $?)"
fm config "$D" merge apply >/dev/null; mk u7 docs/a.md 'u\n'; fm deliver "$D" u7 >/dev/null 2>&1; echo captain >> "$D/docs/a.md"
check "undo refuses after the captain edited the file" 2 "$(fm undo "$D" u7 >/dev/null 2>&1; echo $?)"
check "...and keeps the captain's line" 1 "$(grep -c captain "$D/docs/a.md")"
git -C "$D" checkout -q -- .
if [ -z "$WIN" ]; then
  printf '#!/bin/sh\nexit 1\n' > "$D/.git/hooks/pre-commit"; chmod +x "$D/.git/hooks/pre-commit"
  fm config "$D" merge commit >/dev/null; mk k8 docs/a.md 'k\n'
  check "failing pre-commit hook: reported" 1 "$(fm deliver "$D" k8 2>&1 | grep -c 'commit failed')"
  check "...applied, uncommitted, ledger says apply" "apply 1" "$(tail -1 "$L" | cut -f3) $(git -C "$D" status --porcelain | wc -l | tr -d ' ')"
  rm "$D/.git/hooks/pre-commit"; git -C "$D" checkout -q -- .
fi
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check mới FAIL.
- [ ] **Step 3:** Viết theo Interfaces. Toàn bộ `deliver` và `undo` chạy trong `withLock`.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết, kể cả các test deliver cũ (chế độ mặc định `apply`).
- [ ] **Step 5:** Commit `dev: deliver modes (propose, apply, commit), undo and a ledger`.

### Task 1.7: Gate v2: check của dự án và khoá test nghiệm thu

**Files:**
- Create: `plugin/scripts/fm-detect.js`
- Modify: `plugin/scripts/fm.js` (`gate`; thêm `detect`, `lock`); `plugin/scripts/fm-checks.js` (nhận danh sách check đã cấu hình); `plugin/hooks/guard.js` (chặn ghi vào file bị khoá)
- Test: `tests/59-gate.sh`

**Interfaces:**
- Consumes: `loadConfig`/`setRepoConfig` (1.4), `repoOfWorkspace` (1.3).
- Produces:
  - `detectChecks(repo: string) -> { typecheck?: string, lint?: string, test?: string }`:
    - Trình quản lý gói: có `pnpm-lock.yaml` thì `pnpm`, có `yarn.lock` thì `yarn`, còn lại `npm`.
    - Script `test` của `package.json` (bỏ qua script mặc định `echo "Error: no test specified" && exit 1`) → `<pm> test --silent` (với npm là `npm test --silent`).
    - Script `lint` → `<pm> run lint --silent`.
    - Script `typecheck` → `<pm> run typecheck --silent`. Nếu không có script đó nhưng có `tsconfig.json` và `typescript` trong dependencies → `npx --no-install tsc --noEmit`.
    - `go.mod` → test `go test ./...`, lint `go vet ./...`.
    - `Cargo.toml` → test `cargo test --quiet`.
    - `pytest.ini`, hoặc `pyproject.toml` có `[tool.pytest` → test `python3 -m pytest -q` (trên Windows là `python -m pytest -q`).
    - Có `[tool.ruff` → lint `ruff check .`.
    - `Makefile` có target `test:` → `make test`, chỉ khi chưa tìm được test nào khác.
  - `fm.js detect <repo> [--write]`: in mỗi check một dòng `<name>: <command>`; `--write` lưu vào `checks` trong cấu hình repo.
  - `gate` khi không truyền lệnh: chạy các check theo loại file như v0.12, rồi chạy `config.checks` theo thứ tự `typecheck`, `lint`, `test`. Mỗi check có timeout `checkTimeoutSec` và env slot. Check fail in `FAIL  check <name>: <command>` kèm 25 dòng cuối.
  - `fm.js lock <repo> <task> <path>…`: ghi `<sha256>  <path>` vào `<notes>/<task>.locked` (đường dẫn tương đối so với workspace; file phải tồn tại). Mỗi lần `gate`, kiểm tra khoá trước tiên; file bị đổi hoặc bị xoá thì `FAIL  locked <path> changed after lock`.
  - Guard: agent `worker`, `builder` hoặc `checker` dùng write tool vào một file đã khoá (tìm task qua `repoOfWorkspace`) → deny với lý do `[guard] <path> is a locked acceptance test for task <t>: change the code, not the test.`

- [ ] **Step 1: Write the failing test**
```bash
echo "== gate v2"
J="$T/js"; mkdir -p "$J"; (cd "$J" && git init -q -b main && printf '{"name":"j","scripts":{"test":"node test.js","lint":"node lint.js"}}' > package.json && echo 'process.exit(0)' > test.js && echo 'process.exit(0)' > lint.js && git add -A && git -c user.name=t -c user.email=t@t commit -qm i)
fm init "$J" >/dev/null
check "detect: npm test and lint" 2 "$(fm detect "$J" | grep -cE '^(test: npm test --silent|lint: npm run lint --silent)$')"
fm detect "$J" --write >/dev/null
check "detect --write stores the checks" "npm test --silent" "$(fm config "$J" checks.test)"
G="$T/go"; mkdir -p "$G"; printf 'module x\n' > "$G/go.mod"
check "detect: go" "go test ./..." "$(node -e 'process.stdout.write(require(process.argv[1]).detectChecks(process.argv[2]).test||"")' "$P/scripts/fm-detect.js" "$G")"
N2="$T/npmdefault"; mkdir -p "$N2"; printf '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' > "$N2/package.json"
check "detect: npm's default test script is ignored" "" "$(node -e 'process.stdout.write(require(process.argv[1]).detectChecks(process.argv[2]).test||"")' "$P/scripts/fm-detect.js" "$N2")"
fm start "$J" g1 >/dev/null; JW=$(fm path "$J" g1); echo 'process.exit(1)' > "$JW/test.js"; fm save "$J" g1 x >/dev/null
check "gate runs the project's test" 1 "$(fm gate "$J" g1 2>&1 | grep -c '^FAIL  check test: npm test --silent')"
fm start "$J" g2 >/dev/null; JW2=$(fm path "$J" g2); fm lock "$J" g2 test.js >/dev/null
check "guard: worker may not write a locked test" deny "$(guard wk write_to_file "{\"TargetFile\":\"$JW2/test.js\"}")"
check "guard: worker may write other files" allow "$(guard wk write_to_file "{\"TargetFile\":\"$JW2/lint.js\"}")"
echo '// weakened' >> "$JW2/test.js"; fm save "$J" g2 x >/dev/null
check "gate fails when a locked test changed" 1 "$(fm gate "$J" g2 2>&1 | grep -c 'locked test.js changed after lock')"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check `gate v2` FAIL.
- [ ] **Step 3:** Viết theo Interfaces.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết.
- [ ] **Step 5:** Commit `dev: project checks in the gate and locked acceptance tests`.

### Task 1.8: Guard theo gói: `core` và `devops`

**Files:**
- Create: `plugin/hooks/policy/shell.js`, `plugin/hooks/policy/devops.js`, `plugin/hooks/policy/core.js`, `plugin/hooks/policy/secrets.js`
- Modify: `plugin/hooks/guard.js` (chọn gói theo `loadConfig(repoOf(cwd)).packs`)
- Test: `tests/10-guard.sh` (bảng mới), `tests/15-packs.sh`

**Interfaces:**
- Consumes: `loadConfig` (1.4), `repoOfWorkspace` (1.3).
- Produces:
  - `shell.js`: `words(seg) -> string[]`, `sub(w, valueFlags) -> {name, rest}`, `segments(cmd) -> string[]`. Chuyển nguyên văn từ `guard.js` v0.12.
  - `devops.js`: `judge(seg) -> decision|null`. Các luật kubectl/helm/helmfile/terraform/gcloud/gsutil/ssh của v0.12, **trừ** `git push`.
  - `core.js`:
    - `judgeCommand(seg, ctx: { cwd: string, inWorkspace: boolean }) -> decision|null`:
      - `git push` (mọi dạng) → deny;
      - trong checkout của captain (`!inWorkspace`): `git reset --hard`, `git clean -f…`, `git checkout -- .`, `git restore .`, `git branch -D` → deny;
      - `npm|pnpm|yarn publish`, `twine upload`, `docker push`, `gem push`, `cargo publish` → deny;
      - `psql|mysql|mongosh|mongo|redis-cli` có đối số khớp `PROD_RE` → force_ask;
      - `npm|pnpm|yarn install|add|i` khi `cwd` nằm trong workspace mà `node_modules` ở đó là symlink → deny.
    - `judgeWrite(tool, args, ctx) -> decision|null`: chuỗi `JSON.stringify(args)` chứa secret (`findSecret`) → deny, **trừ** khi đích nằm dưới `~/.aws/`.
  - `secrets.js`: `findSecret(text) -> string|null`. Trả tên loại secret: `AKIA[0-9A-Z]{16}`, `aws_secret_access_key\s*[=:]\s*\S{20,}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `gh[pousr]_[A-Za-z0-9]{36}`, `xox[baprs]-[A-Za-z0-9-]{10,}`, `AIza[0-9A-Za-z_-]{35}`.
  - Một lệnh có secret trong chuỗi lệnh → deny, với thông báo hướng dẫn `aws configure --profile <name>` (người gõ là captain).
  - `packs` mặc định là `['core','devops']`. Phần chống sửa plugin và bảo vệ hồ sơ luôn chạy, không phụ thuộc gói.

- [ ] **Step 1: Write the failing test**
```bash
echo "== guard: core pack"
while IFS='|' read -r want c; do check "core: $c" "$want" "$(guard plain run_command "$(cmdjson "$c")")"; done <<'CASES'
deny|git push --force origin main
deny|npm publish
deny|pnpm publish --access public
deny|twine upload dist/*
deny|docker push registry.example.com/x:1
force_ask|psql postgres://u@db-prod.internal/app -c "select 1"
allow|psql postgres://u@localhost/app -c "select 1"
deny|AWS_ACCESS_KEY_ID=AKIA_ABCDEFGHIJKLMNOP aws s3 ls
deny|set AWS_ACCESS_KEY_ID=AKIA_ABCDEFGHIJKLMNOP&& aws s3 ls
deny|echo "-----BEGIN OPENSSH PRIVATE KEY-----" > id
allow|aws s3 ls --profile acbins-dev
CASES
cwdjson() { node -e 'console.log(JSON.stringify({CommandLine:process.argv[1],Cwd:process.argv[2]}))' "$1" "$2"; }
check "reset --hard in the captain's checkout" deny "$(guard plain run_command "$(cwdjson 'git reset --hard' "$R")")"
check "reset --hard inside a task workspace" allow "$(guard plain run_command "$(cwdjson 'git reset --hard' "$(fm path "$R" t3)")")"
check "branch -D in the captain's checkout" deny "$(guard plain run_command "$(cwdjson 'git branch -D x' "$R")")"
check "secret written to a repo file" deny "$(guard wk write_to_file '{"TargetFile":"/r/creds.txt","CodeContent":"aws_secret_access_key = <a fake 40-character secret, built at run time>"}')"
check "npm install over linked node_modules" deny "$(guard wk run_command "$(cwdjson 'npm install lodash' "$(fm path "$R" t3)/svc")")"
echo "== guard: packs"
mkdir -p "$FM_HOME"; printf '{"packs":["core"]}' > "$FM_HOME/config.json"
check "core only: kubectl delete is not judged" allow "$(guard plain run_command "$(cmdjson 'kubectl delete pod x')")"
check "core only: git push still denied" deny "$(guard plain run_command "$(cmdjson 'git push')")"
rm "$FM_HOME/config.json"
check "default packs include devops" deny "$(guard plain run_command "$(cmdjson 'kubectl delete pod x')")"
```
- [ ] **Step 2:** Chạy `bash tests/run.sh`. Mong đợi: các check mới FAIL. Các check devops cũ vẫn pass.
- [ ] **Step 3:** Tách code và viết luật theo Interfaces. Trong `guard.js` chỉ còn phần ghép: chống sửa plugin → `core` → `devops` (nếu bật) → MCP → budget → kiểm tra crew.
- [ ] **Step 4:** Chạy `bash tests/run.sh`. Mong đợi: pass hết.
- [ ] **Step 5:** Commit `dev: guard packs (core for every developer, devops opt-out) with secret checks`.

### Task 1.9: Bộ benchmark

**Files:**
- Create: `bench/README.md` (quy trình), `bench/tasks.md` (B1–B6: prompt nguyên văn, tiêu chí, tên test ẩn), `bench/fixture/` (repo nhỏ JS + Python), `bench/hidden/B1..B5/` (test ẩn), `bench/solutions/B1..B5.patch` (lời giải mẫu), `bench/selftest.sh`, `bench/results.tsv` (chỉ có header)
- Modify: `.github/workflows/test.yml` (thêm bước `bash bench/selftest.sh`)

**Interfaces:**
- Produces:
  - B1: sửa bug có test đang fail (Unicode trong `slugify`).
  - B2: feature nhỏ (`--json` cho CLI).
  - B3: feature nhiều module, làm song song được (endpoint + client + docs).
  - B4: refactor không đổi hành vi.
  - B5: edge case khó (giao của hai khoảng ngày; dùng để thử arena).
  - B6: chỉ hỏi đáp ("luồng X chạy thế nào"), không sửa code.
  - `bench/selftest.sh`: chép fixture ra thư mục tạm. Trên bản gốc, test ẩn B1–B5 phải FAIL. Sau khi áp `solutions/Bn.patch`, test ẩn Bn phải PASS. In `bench selftest: 10/10`.
  - `results.tsv` có header `date	config	task	strong_tokens	total_tokens	wall_min	hidden_pass	captain_interventions	undo`.

- [ ] **Step 1:** Viết `bench/selftest.sh` và test ẩn trước. Chạy và mong đợi: FAIL (chưa có fixture và lời giải).
- [ ] **Step 2:** Viết fixture và lời giải.
- [ ] **Step 3:** Chạy `bash bench/selftest.sh`. Mong đợi: `bench selftest: 10/10`.
- [ ] **Step 4:** Chạy B1–B6 với firstmate v0.12 trên App. Đo bằng `fm.js usage` và ghi vào `results.tsv` dòng `config=v0.12-app`. Đây là baseline.
- [ ] **Step 5:** Commit `dev: benchmark fixture, hidden tests and the v0.12 baseline`.

---

## Phase 2 — Adapter cho Antigravity IDE (sau Phase 0)

Mỗi task theo đúng chu trình 5 bước (test fail → implement → test pass → commit). Danh sách dưới đây ghi các quyết định đã chốt được; plan chi tiết của Phase 2 viết ở Task 0.3.

### Task 2.1: `platform.js`
**Files:** Create `plugin/hooks/platform.js`; Modify `plugin/hooks/lib.js` (dùng adapter); fixtures `tests/fixtures/ide-home/.gemini/antigravity-ide/{brain,conversations}/…` theo schema ghi ở Q6. Test `tests/25-platform.sh`.
**Interfaces (produces):**
- `platformOf(ev) -> 'app'|'ide'|'cli'|'unknown'`: dựa vào `artifactDirectoryPath` hoặc `transcriptPath`.
- `brainDirs() -> string[]`; `transcriptOf(id, ev) -> string|null`.
- `agentOf(id, st, model, ev) -> string`: chuyển từ `lib.js` sang, thêm nhánh IDE đọc `conversations/<id>.db`.
- `skillDirs() -> string[]`; `toolAliases(name) -> string[]`.
**Tests:**
- chat IDE: nhận ra `firstmate`, `builder`, `reader`, `judge`;
- budget được reset khi transcript IDE có `USER_INPUT` mới;
- chat App vẫn nhận ra như cũ (các test của v0.12).

### Task 2.2: Installer v1
**Files:** Modify `install.js`, `plugin/plugin.json`, `package.json`, các regex chống sửa plugin trong `guard.js`. Test `tests/80-install.sh` (chạy với `HOME="$T/home"`).
**Quyết định:**
- `NAME = 'firstmate'`; đích cài theo Q1.
- Gỡ `flash-ultra` (có backup) và xoá mục của nó trong `config.json`.
- `--packs core,devops` ghi vào `$FM_HOME/config.json`.
- `--check` báo IDE, App, `FM_HOME`, và `wtRoot` có ghi được không.
- Thông báo cuối: "restart Antigravity IDE, re-select firstmate".
- Chống sửa plugin nhận cả hai tên trong một bản chuyển tiếp.
**Tests:**
- file nằm đúng thư mục đích;
- `flash-ultra` bị gỡ;
- `config.json` có `firstmate.enabled`;
- `--packs` được ghi;
- `--check` có dòng `Antigravity IDE`.

### Task 2.3: Tên tool và manifest
**Files:** Modify `tests/10-guard.sh` (danh sách `KNOWN` theo Q9), `READ_TOOLS`/`WRITE_TOOLS` trong `guard.js`. **Tests:** test manifest hiện có, chạy với danh sách mới.

## Phase 3 — Vai trò mới: System 1 / System 2

### Task 3.1: Hợp đồng brief và các kiểm tra của guard
**Files:** Create `plugin/hooks/brief.js`; Modify `guard.js`. Test `tests/12-brief.sh`.
**Interfaces:**
- `parseBrief(prompt) -> { role, task, workspace, model, owns: string[], skills: string[], doneWhen }`: đọc các dòng header cho tới dòng trống đầu tiên; khoá không phân biệt hoa thường.
**Luật của guard khi gặp `invoke_subagent`:**
- `TypeName` phải thuộc {`reader`, `builder`, `judge`}; tên cũ bị từ chối kèm hướng dẫn.
- `builder` bắt buộc có `WORKSPACE`; không được có hai builder cùng một `WORKSPACE`.
- `MODEL`: `reader`/`builder` ∈ {fast, standard}, `judge` = strong. Guard `overwrite` thành `config.models[...]`.
- `SKILLS`: mọi tên phải có trong `skillDirs()`, nếu không thì deny và liệt kê tên không tồn tại.
- Trần `caps.perCall`, `caps.crewPerDay`, `caps.judgePerDay`.
**Tests:** bảng payload cho từng luật, kèm đường dẫn kiểu Windows trong `WORKSPACE`.

### Task 3.2: Bộ agent mới
**Files:** Create `plugin/agents/{reader,builder,judge}.md`; viết lại `firstmate.md`, `rules/AGENTS.md`; xoá `explorer.md`, `worker.md`, `checker.md`.
**Nội dung:**
- Cả ba agent crew và judge đều có `inheritCustomizations: true`; `reader` và `builder` có thêm `inheritMcp: true` (G4).
- `firstmate`: trả lời câu hỏi, làm khi được yêu cầu, viết brief theo hợp đồng, luật gọi judge theo spec 3.4, `fm.js ladder` quyết định leo thang. Chỉ `send_message` lại cho builder cũ trong vòng sửa của **cùng** task; task mới thì gọi builder mới.
- `builder`: `WORKSPACE`, `OWNS`, tự `save` + `gate`, báo cáo `STATUS/CHECK/NOT DONE/QUESTIONS/SKILLS USED`.
- `judge`: chỉ đọc dossier, trả `VERDICT: APPROVE|REVISE|REJECT|HUMAN`, kèm rubric và lý do, được phép nâng rủi ro.
**Tests:**
- manifest: tên tool hợp lệ;
- `firstmate.md` không còn chuỗi `→ quick`;
- `judge.md` có dòng định dạng verdict;
- `grep -r 'explorer\|worker\|checker' plugin/` = 0 (trừ ghi chú chuyển đổi).

### Task 3.3: `inject.js` v1
**Files:** Modify `plugin/hooks/inject.js`; thêm `fm.js handoff <repo> "<text>"` (ghi `<notes>/handoff.md`). Test `tests/30-hooks.sh`.
**Quyết định:**
- Luật cho từng vai ngắn, ổn định.
- Facts và handoff chỉ nạp vào `firstmate`; crew nhận đường dẫn qua brief.
- Dòng budget chỉ xuất hiện khi model của agent chính là model mạnh.
- Khi `input + cache` của lần gọi gần nhất trong transcript vượt `handoffAtTokens`, thêm dòng: `context ~<N>k tokens: write fm.js handoff, then suggest a new chat`.
**Tests:**
- phiên của subagent không có facts;
- firstmate có facts và handoff;
- firstmate chạy Flash không có dòng budget;
- firstmate chạy Argon có dòng budget;
- transcript 160k có dòng cảnh báo.

### Task 3.4: Dossier cho judge
**Files:** Modify `fm.js` (`start --request "<text>"` ghi `<notes>/<t>.request`; thêm `dossier`). Test `tests/62-dossier.sh`.
**Interface:** `fm.js dossier <repo> <task>` in các mục `REQUEST`, `DONE WHEN`, `RISK`, `LOCKED TESTS`, `GATE` (các dòng PASS/FAIL), `REVIEW` (đầu ra `review`, cắt trước tiên), `SCENARIOS` (nếu có `<notes>/<t>.scenarios`). Tổng cộng ≤ 30720 byte.
**Tests:** đủ các mục; diff 5.000 dòng vẫn cho ra ≤ 30720 byte; `REQUEST` khớp nguyên văn.

### Task 3.5: Playbook thành tài liệu tham khảo
**Files:** Xoá `skills/firstmate/playbooks/*`, `skills/how`, `skills/investigate`, `skills/change`; tạo `skills/firstmate/patterns.md`; cập nhật `skills/best/SKILL.md` sang `builder`/`judge`; sửa `skills/firstmate/SKILL.md`.
**Tests:** không còn thư mục playbooks; `best/SKILL.md` không nhắc `worker` hay `checker`.

## Phase 4 — Chất lượng

### Task 4.1: Phán quyết của judge
**Interface:** `fm.js verdict <repo> <task> APPROVE|REVISE|REJECT|HUMAN "<reason>" [--risk medium|high]` ghi `<notes>/<t>.verdict` = `<head-sha> <VERDICT>`. `--risk` chỉ được nâng mức trong `<t>.risk`, không được hạ.
**Quyết định:**
- `deliver`: rủi ro `medium` cần `APPROVE` trên đúng head hiện tại; verdict cũ hoặc thiếu verdict thì chạy như `propose`.
- Rủi ro cao hơn `autoMergeMaxRisk` thì luôn chạy như `propose`. Ví dụ đặt `low` thì cả medium cũng chờ captain.
- Cột `verdict` của ledger được điền.
- Guard: `reader` và `builder` không được chạy `fm.js verdict`.
**Tests:** verdict cũ thì propose (mã 3); có APPROVE thì commit; builder bị chặn.

### Task 4.2: `fm.js ladder`
**Quyết định:**
- `gate` ghi thêm vào `<notes>/<t>.attempts` dòng `<sha> PASS|FAIL`.
- `fm.js ladder <repo> <task>` in `NEXT: <bước>` theo spec 3.4: `build` | `review` | `fix` | `arena 3` | `judge rescue` | `ask captain`. Rescue được đánh dấu bằng file `<t>.rescued`.
**Tests:** bảng trạng thái (attempts, có arena chưa, đã rescue chưa) → bước tiếp theo.

### Task 4.3: Arena cho code
**Interfaces:**
- `fm.js arena <repo> <task> --n <2..5>`: tạo các task `<task>--a`…, cùng một base, mỗi cái một slot.
- `fm.js arena-status <repo> <task>`: gate và diff stat của từng bản.
- `fm.js arena-pick <repo> <task> <variant>`: đưa head của bản được chọn vào `<task>`, dọn các bản còn lại.
**Tests:** đủ N workspace; guard cho mỗi bản một builder; pick xong chỉ còn `<task>`; base không đổi.

### Task 4.4 (tuỳ chọn, chỉ làm nếu Q4 có model khác họ): reviewer thứ hai khác họ model
`judge` thứ hai chạy trên model khác họ, đọc cùng dossier. `deliver` với rủi ro medium cần cả hai APPROVE, hoặc một APPROVE và một REVISE có lý do đã được firstmate xử lý.

## Phase 5 — Tự chủ và niềm tin

### Task 5.1: Bỏ "go", đổi chế độ merge mặc định
**Quyết định:**
- Prompt `firstmate`: câu hỏi thì trả lời, yêu cầu thì làm, mơ hồ thì hỏi đúng một câu. Rủi ro high thì dừng.
- `DEFAULTS.merge` lấy theo D2.
**Tests:** `firstmate.md` không còn yêu cầu "go"; `fm config <repo> merge` trả về giá trị theo D2.

### Task 5.2: `fm.js trust` và `fm.js report`
**Interfaces:**
- `fm.js trust <repo>`: số task đã merge, số lần `undo`, số lần captain tự revert (dò `git log --grep '^Firstmate-Task:'` và các commit `This reverts commit <sha>`), tỷ lệ, gợi ý chế độ.
- `fm.js report <repo> [--since <iso>]`: chia ba nhóm: đã merge, đang chờ (propose hoặc high), thất bại.
**Tests:** ledger mẫu cùng một revert thủ công cho ra đúng tỷ lệ; `--since` lọc đúng.

## Phase 6 — Phát hành

### Task 6.1: Benchmark v1
Chạy B1–B6 với các cấu hình `ide-default-flash`, `ide-default-argon`, `v1-ide`, ghi vào `bench/results.tsv`. Viết `docs/benchmarks.md`, so với chỉ số ở spec mục 6. Nếu không đạt, ghi lý do và quyết định: sửa tiếp, hay phát hành kèm nêu rõ giới hạn.

### Task 6.2: Tài liệu và bản phát hành
**Files:**
- `README.md`: IDE, ưu tiên dev, các gói guard, quyền tự chủ, `undo`.
- `docs/architecture.md`.
- `MIGRATION.md`, từ v0.12 lên v1.0: hoàn tất hoặc `fm.js clean --all` các task đang dở; task cũ trong repo vẫn chạy được; cài lại; chọn lại agent; `fm.js clean --legacy`.
- `plugin/plugin.json`, `package.json`: phiên bản `1.0.0`.
- CI: thêm `bench/selftest.sh`.
**Bước:** chạy `bash tests/run.sh` trên CI 3 OS → commit `v1.0.0: …` → tag `v1.0.0`. Captain duyệt trước khi push.

### Task 6.3: Mã chỉ dành cho App
Theo D4: hoặc gỡ các nhánh code chỉ phục vụ App (đọc `conversation_summaries.db` của App), hoặc giữ lại và ghi App là "không còn phát triển" trong README.
