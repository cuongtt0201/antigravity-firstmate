# antigravity-firstmate

Plugin `flash-ultra` cho **Google Antigravity App**: Gemini Argon làm *first mate* (lên kế hoạch, giao việc, merge), Gemini Flash làm *crew* (viết code trong git worktree riêng), một Flash *checker* kiểm độc lập trước khi merge. Mục tiêu: tốn ít token Argon, bù chỗ yếu của Flash bằng quy trình kiểm chứng.

## Cài đặt

Cần Node ≥ 18 và quyền đọc repo này (SSH key GitHub đã cấu hình).

```bash
npx -y github:cuongtt0201/antigravity-firstmate
```

Hoặc clone về rồi chạy:

```bash
git clone git@github.com:cuongtt0201/antigravity-firstmate.git && node antigravity-firstmate/install.js
```

Installer sẽ:
1. Chép `plugin/` vào `~/.gemini/config/plugins/flash-ultra/` (bản cũ được sao lưu vào thư mục tạm).
2. Điền đường dẫn thật của máy (thư mục plugin, `node`) vào `hooks.json` và các file firstmate.
3. Bật plugin trong `~/.gemini/config/config.json` (sao lưu `config.json.bak-flash-ultra-<thời gian>` trước khi sửa).
4. Khóa plugin ở chế độ chỉ đọc để agent không tự sửa guardrail.

Cập nhật: chạy lại đúng lệnh cài. Gỡ: thêm `--uninstall`.

## Sau khi cài

1. Khởi động lại Antigravity App, kiểm tra **Customizations → Plugins** có `flash-ultra`.
2. **Tắt Terminal Sandbox** trong Settings. Khi bật, worker trong worktree không chạy được `git`, `pip`, `uv` (thư mục `.git` gốc nằm ngoài sandbox và mạng bị chặn).
3. Mỗi project phải là git repo **trước khi** thêm vào Projects của App, nếu không App báo "Worktrees are not available for this project". Đã lỡ thêm thì gỡ project ra rồi thêm lại.
4. Mở chat chính ở chế độ **Local** (không phải New Worktree), chọn agent **firstmate** + Gemini 4 Argon, gõ `/firstmate <việc cần làm>`.
5. Tuỳ chọn: `brew install uv` để worker dùng được các skill của plugin Science (arXiv, OpenAlex…).

## Có gì bên trong

| Thành phần | Vai trò |
|---|---|
| `agents/firstmate.md` | Agent chính (Argon). Không tự sửa code: plan, giao việc, gọi checker, merge |
| `agents/worker.md` | Flash, làm mọi việc được giao; kế thừa skill/plugin/MCP, có `search_web` |
| `agents/checker.md` | Flash, chỉ đọc. Đối chiếu với đề gốc; code thì chạy test và ≥12 ca đối kháng |
| `skills/firstmate` | Quy trình captain → first mate → crew (`/firstmate`) |
| `skills/best` | Best-of-N: 3 bản nháp → chấm điểm → viết lại (`/best`) |
| `skills/shipd` | Kinh nghiệm làm quest Shipd (Datacurve) |
| `rules/AGENTS.md` | Luôn bật: giọng văn điềm tĩnh, không bịa số liệu |
| `hooks/guard.js` | Ép worker/checker chạy Flash, chặn đọc lặp, chặn agent sửa plugin |
| `scripts/fm-*.sh` | `fm-init` tạo repo + base commit, `fm-status` xem nhánh/worktree, `fm-merge` merge an toàn |

## Sửa plugin

Sửa trong `plugin/` của repo này, commit, rồi chạy lại lệnh cài trên từng máy. Không sửa trực tiếp bản đã cài trong `~/.gemini/config/plugins/flash-ultra/` (bị khóa chỉ đọc và sẽ bị ghi đè khi cài lại).
