# firstmate v1.0 — Thiết kế

- **Ngày:** 2026-11-01
- **Trạng thái:** bản nháp, chờ captain duyệt (mục 5 có các quyết định cần chốt)
- **Dựa trên:** v0.12.0 (`origin/main` 665c33e). Bộ test hiện tại: 227 pass.
- **Kế hoạch triển khai:** [../plans/2026-11-01-firstmate-v1.md](../plans/2026-11-01-firstmate-v1.md)

---

## 1. Bối cảnh

### 1.1 Mục tiêu v1.0 (captain đặt ra)
- **G1.** Chuyển sang **Antigravity IDE**, không phát triển tiếp cho Antigravity App.
- **G2.** Tiết kiệm token.
- **G3.** Chọn agent linh hoạt hơn.
- **G4.** Sub-agent dùng được skill của các plugin.
- **G5.** Chia thành **System 1** (nhanh, rẻ) và **System 2** (nghĩ sâu).
- **G6.** Tự chuyển giữa các model nhỏ, rẻ để cân bằng tốc độ và chất lượng.

### 1.2 Feedback từ thực tế dùng v0.10–v0.12
- **F1.** Argon tốn quá nhiều; context bị đọc lại lặp đi lặp lại, hao token và quota.
- **F2.** Hệ thống chạy tất định theo các file skill/playbook, cứng nhắc.
- **F3.** Worktree của worker chạy chưa tốt.
- **F4.** Bỏ các câu "go"/"làm đi". Firstmate tự giao việc review rồi tự merge vào máy chính. Xoá hết nhánh worker cũ, không để sinh rác.
- **F5.** Sub-agent có tên và chức năng cố định sẵn (explore, investigate, best…), không hợp. Firstmate phải là bên quy định vai trò.
- **F6.** Thuyền viên quá ít.

### 1.3 Mục đích của plugin
- **P1.** Người dùng chính là **dev**, không chỉ DevOps.
- **P2.** Sinh ra nhiều việc cùng lúc; dùng nhiều phương án để bù chỗ Gemini Flash nghĩ nông.
- **P3.** Argon (model mới, mạnh) kiểm tra, thử và duyệt kết quả của Flash.
- **P4.** Tăng niềm tin của user vào agent: không cần review code nhiều, có thể để chạy liên tục.

### 1.4 Số đo từ một chat thật trên v0.12 (đo ngày 27/10, chat "DevOps Handoff Documentation Review")
| Chỉ số | Giá trị (đo) |
|---|---|
| Phần token của Argon | input mới 47%, cache 53%, output 56% |
| Số tin nhắn của captain | 93; có 49 tin là hỏi nhanh, chiếm 40% lượng context Argon đọc |
| Context Argon đọc trung bình mỗi tin nhắn | ~403k token (chat cũ v0.10: ~515k; khác biệt nằm ở số tin nhắn, không ở chi phí mỗi tin) |
| Context mỗi lần gọi Argon | lần đầu 23k, trung vị ~145k, tối đa ~250k (App tự nén khi chạm ~250k) |
| Cache miss | 8 lần gọi gây ra 1,23M / 2,24M input mới (55%) |
| Argon tự gọi tool | 113 lần (51 `view_file`); 0 explorer; budget 6 mỗi tin nhắn không chặn lần nào |
| Dùng lại worker | 1 worker làm 5 task liên tiếp, 20,8M cache đọc |
| Facts | 47 dòng được nạp vào mọi chat **và mọi subagent** |

### 1.5 Bài học từ các dự án tương tự
- **pstack (Lauren Tan):** chất lượng đến từ `arena` (N bản làm song song, giám khảo chấm theo rubric kín, chọn một bản làm nền rồi ghép ưu điểm của các bản khác), `interrogate` (review chéo nhiều họ model), verification skill riêng cho từng app, và autonomous run (mỗi vòng một thay đổi → kiểm → giữ hoặc bỏ → ghi log). v0.x mới lấy phần nghi thức (router, checklist), chưa lấy phần tạo chất lượng.
- **firstmate (Kun Chen):** first mate ngủ, watcher chỉ đánh thức khi cần; chia task thành ship/scout; quyền merge chỉnh theo từng project (`no-mistakes`, `direct-PR`, `local-only`, `+yolo`); worktree lấy từ pool nằm ngoài repo, dùng lại được (treehouse).
- **Thị trường (OpenClaw…):** các harness hạ nhiệt khi nền tảng tự làm luôn tính năng của họ, khi chi phí token cao, khi bị chặn đường vào nền tảng, và khi có sự cố bảo mật. Vì vậy plugin nên mỏng, chỉ dùng các điểm mở rộng chính thức, thân thiện với cache, và kiểm soát nguồn skill.

---

## 2. Nguyên tắc thiết kế
1. **Plugin mỏng.** Dùng những gì IDE có sẵn (subagent, chọn model, skill, có thể cả worktree). Plugin chỉ thêm: điều phối, kiểm chứng, quyền merge, guard an toàn, facts, kỷ luật chi phí. Khi nền tảng đã làm được một việc thì xoá code của mình đi.
2. **Code giữ các luật bất biến, model quyết định quy trình.** Bỏ việc bắt buộc chọn playbook và chép checklist.
3. **Niềm tin đến từ bằng chứng.** Mỗi thay đổi được merge đều có hồ sơ (gate, phán quyết của judge, mức rủi ro) và hoàn tác được bằng một lệnh.
4. **Bắt đầu rẻ, nâng cấp khi thất bại.** Thang model do code quyết định, không để model tự đoán.
5. **Thân thiện với cache.** Phần đầu prompt ổn định; System 2 không mang lịch sử chat mà nhận một hồ sơ gọn.

---

## 3. Kiến trúc v1

### 3.1 Vai trò
| Agent | Model mặc định | Quyền | Context mang theo | Khi nào chạy |
|---|---|---|---|---|
| `firstmate` (System 1) | standard (Flash) | đọc, chạy lệnh, gọi subagent; không sửa code của captain | lịch sử chat (rẻ) | luôn luôn: nói chuyện, trả lời câu nhỏ, chia việc, chạy pipeline merge |
| `reader` | fast hoặc standard | chỉ đọc | brief | đọc code, tìm hiểu, điều tra |
| `builder` | standard | ghi **chỉ trong workspace của task** | brief | sửa code, viết test, đóng vai tester |
| `judge` (System 2) | strong (Argon) | chỉ đọc | **hồ sơ (dossier) ≤ 30 KB**, không có lịch sử chat | viết tiêu chí nghiệm thu, duyệt trước merge, gỡ rối khi thang leo tới, hoặc khi captain nói "nghĩ kỹ" |

- Không còn agent `explorer`, `worker`, `checker`. Vai trò cụ thể ("tester cho module X", "reviewer migration") do firstmate viết vào brief.
- Mọi crew và judge đều kế thừa skill và MCP của captain (G4). Brief ghi rõ skill nào được dùng; guard từ chối tên skill không tồn tại.

### 3.2 Hợp đồng brief
Mỗi lần `invoke_subagent`, prompt bắt đầu bằng các dòng header mà code đọc được:
```
ROLE: <do firstmate tự viết>
TASK: <task-id>        WORKSPACE: <đường dẫn workspace, chỉ builder>
MODEL: fast|standard|strong
OWNS: <các path hoặc glob builder được sửa>
SKILLS: <tên skill, cách nhau bởi dấu phẩy> | none
DONE WHEN: <tiêu chí nghiệm thu hoặc lệnh kiểm tra>
```
Guard dựa vào header này để kiểm tra: mỗi WORKSPACE chỉ một builder, MODEL nằm trong danh sách cho phép của loại agent, SKILLS có thật, và chưa vượt trần số lần gọi.

### 3.3 Luồng một yêu cầu
```
captain ─► firstmate (S1)
            ├─ câu hỏi ─► tự trả lời, hoặc gửi reader ─► trả lời
            └─ yêu cầu làm ─► chia task ─► [judge viết tiêu chí nếu rủi ro dự kiến ≥ medium]
                 ─► fm.js start (mỗi task một workspace) ─► builder sửa ─► fm.js gate
                 ─► fm.js ladder (thất bại thì: thử lại → arena → judge gỡ rối → hỏi captain)
                 ─► fm.js review + dossier ─► judge: APPROVE | REVISE | REJECT | HUMAN
                 ─► fm.js risk ─► fm.js deliver (propose | apply | commit) ─► ledger ─► báo cáo
```
Không còn bước "chờ go". Mức rủi ro cao thì vẫn dừng lại chờ captain.

### 3.4 Thang model và leo thang (G5, G6)
| Tình huống | Bước tiếp theo (do `fm.js ladder` trả về) |
|---|---|
| Gate FAIL lần 1–2 | builder cũ tự sửa (đã có context) |
| Gate FAIL lần 3 | `arena`: 3 builder mới, mỗi bản một hướng, chung một base |
| Không bản nào của arena pass | `judge` chẩn đoán (rescue), viết lại brief |
| Rescue vẫn thất bại | hỏi captain, kèm chẩn đoán |
| Rủi ro dự kiến ≥ medium | judge viết tiêu chí trước (≤ 1 lần mỗi task) |
| Trước khi merge, rủi ro ≥ medium | judge duyệt (≤ 2 lần mỗi task) |

Tên model thực tế (`flash-lite`, `flash`, `argon`…) đặt trong cấu hình `models.fast|standard|strong`. Giá trị IDE chấp nhận sẽ được xác định ở Phase 0.

### 3.5 Workspace v2 (F3)
- Worktree nằm **ngoài repo**: `~/.firstmate/wt/<repo-key>/<task>`, với `repo-key = <tên thư mục>-<8 ký tự sha1 của đường dẫn thật>`. IDE không còn index trùng file. Biến `FM_WT_ROOT` để đặt chỗ khác nếu sandbox của IDE không cho ghi ra ngoài workspace.
- Task vẫn dùng `refs/firstmate/<task>/{base,head}`, **không tạo branch**.
- Mỗi task một **slot**. Lệnh check chạy với `FIRSTMATE_SLOT=<n>` và `PORT=<portBase+n>` để các worktree chạy song song không tranh cổng.
- Có khoá theo repo, để hai chat hoặc hai lệnh `fm.js` cùng lúc không giẫm lên nhau.
- `fm.js sweep`: dọn task cũ. `fm.js clean --legacy`: dọn nhánh `subagent-*` và worktree do Antigravity tạo từ thời v0.7. Cả hai **mặc định chỉ liệt kê**, phải có `--yes` mới xoá; nhánh chưa merge chỉ bị xoá khi có thêm `--force`.
- Nếu Phase 0 cho thấy IDE tự tạo worktree cho từng subagent, sẽ đánh giá việc dùng tính năng đó (nguyên tắc 1). `fm.js` vẫn giữ vai trò nguồn sự thật cho base, head và gate.

### 3.6 Quyền merge, rủi ro, hoàn tác (F4, P4)
- Chế độ merge, cấu hình theo repo:
  - `propose`: dừng lại, chờ captain;
  - `apply`: đưa vào thư mục làm việc dưới dạng chưa commit (như `deliver` hiện tại);
  - `commit`: mỗi task một commit, có trailer `Firstmate-Task:` và `Firstmate-Risk:`.
- Trên nhánh được bảo vệ (`main`, `master`, `release/*`), chế độ `commit` lùi về `apply`, trừ khi bật `commitOnProtected`.
- `fm.js risk`: phân loại `low | medium | high` bằng luật tất định (đường dẫn, loại file, kích thước, file bị xoá, dependency, CI, migration, auth, secret). Judge có thể nâng mức rủi ro, không thể hạ.
- Điều kiện merge tự động:

  | Rủi ro | Điều kiện để tự merge |
  |---|---|
  | low | gate PASS |
  | medium | gate PASS + judge APPROVE |
  | high | luôn dừng, chờ captain `--approve` |

- `fm.js undo <task>`: chế độ commit thì `git revert`; chế độ apply thì `git apply -R` bằng patch đã lưu. Từ chối nếu file đã bị sửa sau đó.
- `.firstmate/notes/ledger.tsv`: mỗi lần merge một dòng. `fm.js trust` tính tỷ lệ bị hoàn tác để gợi ý nới hay siết quyền tự chủ.

### 3.7 Kiểm chứng (P2, P3)
- **Gate v2:** giữ các check theo loại file đang có (YAML, JSON, sh, py, tf, Helm), thêm check của chính dự án. `fm.js detect` đọc `package.json`, `tsconfig`, `pyproject`, `go.mod`, `Cargo.toml`, `Makefile` rồi ghi các lệnh `typecheck`/`lint`/`test` vào cấu hình.
- **Khoá test nghiệm thu:** `fm.js lock` ghi lại sha256 các file test do judge hoặc tester viết. Gate FAIL nếu file khoá bị đổi, và guard chặn builder ghi vào file khoá. Mục đích: chặn chuyện Flash sửa test cho pass.
- **Arena cho code:** `fm.js arena` tạo N workspace từ cùng một base. Judge chấm theo rubric kín, chọn một bản, ghép thêm từ các bản khác, rồi `fm.js arena-pick`.
- **Review:** giữ `fm.js review` (diff, nơi dùng tên bị đổi, file liên quan chưa đổi, checklist). Thêm `fm.js dossier`: hồ sơ gọn cho judge.
- **Review chéo nhiều họ model:** chỉ làm nếu Phase 0 thấy IDE cho subagent chạy Claude hoặc GPT. Lý do: Flash và Argon cùng họ Gemini, dễ sai giống nhau.

### 3.8 Guard theo gói (P1)
- **`core`**, luôn bật:
  - chống sửa plugin;
  - cấm `git push`;
  - git phá hoại trên checkout của captain (`reset --hard`, `clean -f`, `checkout -- .`, `branch -D`);
  - publish (`npm publish`, `twine upload`, `docker push`…);
  - client DB trỏ vào host prod thì phải hỏi;
  - **secret** trong lệnh hoặc nội dung ghi file (AWS key, private key, token GitHub/Slack/Google);
  - `npm install` trong workspace có `node_modules` là symlink;
  - giữ vệ sinh hồ sơ: crew không được tự ghi gate, notes, facts, ledger, verdict, refs.
- **`devops`**: các luật k8s/helm/terraform/gcloud/gsutil/ssh hiện có.
- **Mặc định bật cả hai.** Với dev không dùng k8s, gói `devops` gần như không tốn gì: luật chỉ chạy khi gặp đúng các lệnh đó, check chỉ chạy khi file `.tf`/chart thay đổi. Thứ dev thiếu không phải là bớt luật DevOps, mà là check test/lint và các luật cho rủi ro của dev. Cấu hình `packs` cho phép tắt.

### 3.9 Kỷ luật token (F1, G2)
| Cơ chế | Tác động dự kiến (suy ra, sẽ đo bằng `fm.js usage`) |
|---|---|
| Agent chính chạy Flash | Lượt đọc lịch sử chat chuyển từ Argon sang Flash. Đây là khoản lớn nhất trong số đo ở 1.4 |
| Judge không mang lịch sử, dossier ≤ 30 KB | Mỗi lần gọi Argon ~10k thay vì 100–250k |
| Trần số lần gọi judge mỗi task (spec ≤ 1, duyệt ≤ 2, rescue ≤ 1) và mỗi ngày | Số lần gọi Argon có giới hạn |
| Facts chỉ nạp vào agent chính; crew nhận đường dẫn | Bỏ ~47 dòng ở mỗi phiên subagent |
| Bỏ checklist playbook | Bớt output của S1 |
| Crew mới cho mỗi task (không dùng lại cho task khác) | Context crew không phình |
| Budget đọc trực tiếp chỉ áp dụng khi agent chính chạy model mạnh | Không phạt S1 rẻ |
| `fm.js handoff` + cảnh báo khi context > ngưỡng | Có đường thoát khi chat quá dài |

### 3.10 Nền tảng: Antigravity IDE (G1)
Đã thấy trên máy (đo ngày 01/11):
- Có cả `Antigravity.app` 2.28.2 và `Antigravity IDE.app` 2.6.0.
- IDE dùng thư mục `~/.gemini/antigravity-ide/`: có `brain/<id>/.system_generated/logs/transcript.jsonl`, `conversations/<id>.db` (mỗi chat một DB), `plugins/` (đang chứa `Google.securecoder.securecoder`). **Không có** `conversation_summaries.db` chung.
- Hệ quả: `lib.js agentOf()` và `lastUserStep()` của v0.12 sẽ **không nhận ra agent** trong IDE. Cần một lớp adapter cho từng nền tảng.

Phase 0 phải trả lời các câu hỏi Q1–Q9 (xem kế hoạch) trước khi viết code phụ thuộc IDE. Cây quyết định:
- **Plan A:** IDE nạp được plugin, hook và subagent → làm như thiết kế.
- **Plan B:** IDE nạp plugin nhưng không có subagent → crew chạy bằng tiến trình CLI (`agy`) do `fm.js` khởi động, theo kiểu Kun Chen.
- **Plan C:** IDE không nạp được plugin → v1.0 vẫn chạy trên App, G1 lùi sang v1.1.

---

## 4. Giữ / đổi / bỏ so với v0.12
| Thành phần v0.12 | v1.0 |
|---|---|
| `agents/firstmate.md` | Viết lại cho S1: ngắn, không playbook, có luật khi nào gọi judge, hợp đồng brief, cách dùng ladder |
| `agents/worker.md`, `explorer.md`, `checker.md` | Thay bằng `builder.md`, `reader.md`; `judge.md` mới; vai trò tester nằm trong brief |
| `skills/firstmate/playbooks/*`, `skills/how`, `skills/investigate`, `skills/change` | Bỏ; gộp thành `skills/firstmate/patterns.md` để tham khảo, không bắt buộc |
| `skills/best` | Giữ (đây chính là arena cho văn bản), đổi tên agent |
| `rules/AGENTS.md` | Viết lại cho dev: bỏ phần nhắc worker/checker và playbook |
| `hooks/inject.js` | Luật ngắn, ổn định; facts chỉ cho agent chính; handoff |
| `hooks/guard.js` | Tách thành các gói policy; kiểm tra brief; danh sách model cho phép; trần theo cấu hình |
| `hooks/lib.js` | Dùng `platform.js` (App, CLI, IDE) |
| `scripts/fm.js` | wt ngoài repo, slot, khoá, cấu hình, risk, deliver theo chế độ, undo, ledger, detect, lock, sweep, clean --legacy, usage, dossier, ladder, arena, verdict, trust, report |
| `scripts/fm-checks.js` | Thêm check của dự án |
| `install.js` | Đích IDE, đổi tên plugin `flash-ultra` → `firstmate`, `--packs`, `--check` cho IDE |
| `tests/run.sh` | Tách thành `tests/lib.sh` và các file theo từng phần |

---

## 5. Quyết định cần captain chốt
| # | Câu hỏi | Đề xuất |
|---|---|---|
| D1 | Agent chính chạy Flash (S1), Argon chỉ là judge (S2)? | **Có** |
| D2 | Chế độ merge mặc định | **`commit`** (một commit mỗi task, `undo` được). Trên nhánh bảo vệ thì lùi về `apply` |
| D3 | Bỏ hoàn toàn "go"? | **Bỏ**; riêng rủi ro high vẫn dừng chờ captain |
| D4 | Còn hỗ trợ App không? | **Không**, nếu Phase 0 ra Plan A hoặc B. Ra Plan C thì giữ App cho v1.0 |
| D5 | Gói guard mặc định | **`core` + `devops`**, tắt được bằng cấu hình |
| D6 | Chạy liên tục (hàng đợi, `/afk`) | **Để v1.1**; v1.0 có merge tự động theo rủi ro và `fm.js report` |
| D7 | Đổi id plugin `flash-ultra` → `firstmate` | **Có**; installer tự gỡ bản cũ (có backup) |

---

## 6. Chỉ số thành công (đề xuất, đo bằng bộ benchmark ở Phase 1)
- Token Argon ≤ **20%** tổng token trên bộ benchmark (v0.12 đo được 47–56% ở chat thật).
- Context mỗi lần gọi judge ≤ **40k** token.
- Task chỉ hỏi đáp (B6) dùng **0** lần gọi Argon.
- Tỷ lệ pass test ẩn ≥ mức của cấu hình "chỉ dùng Argon".
- Task rủi ro low/medium: captain can thiệp ≤ **1** lần mỗi task. Tỷ lệ bị `undo` < **10%**.

## 7. Rủi ro chính
| Rủi ro | Giảm thiểu |
|---|---|
| IDE thiếu subagent hoặc hook | Phase 0 làm trước; có Plan B và C |
| S1 chạy Flash quên leo thang | Điều kiện leo thang nằm trong code (`ladder`; `deliver` đòi verdict khi rủi ro ≥ medium) |
| Tự merge một thay đổi sai | Risk gate + judge + `undo` + ledger + `trust` |
| Flash sửa test cho pass | Khoá test nghiệm thu, cả ở gate lẫn ở guard |
| `npm install` trong worktree làm hỏng `node_modules` của captain (đang dùng chung qua symlink) | Guard chặn; muốn đổi dependency thì task đó là rủi ro high |
| Hai chat cùng sửa một repo | Khoá theo repo, slot riêng |
| Windows | CI chạy 3 OS; test riêng cho đường dẫn dạng Windows |

## 8. Ngoài phạm vi v1.0 (dự kiến v1.1+)
- Hàng đợi việc và chế độ vắng mặt (`/afk`), watcher.
- Verification skill riêng cho từng app (kiểu pstack: tự khởi động app và chạy thử hành vi thật).
- Pool worktree tái sử dụng có dependency riêng (kiểu treehouse).
- Review chéo nhiều họ model, nếu IDE chưa hỗ trợ.
