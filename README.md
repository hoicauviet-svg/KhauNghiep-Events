# Khẩu Nghiệp · kịch bản online

Kho lưu kịch bản cho game Khẩu Nghiệp và trang web để sửa kịch bản.

- `events.json`: nhân vật, động tác, 5 màn cố định và kho tình huống random. Game tải file này.
- `manifest.json`: `version` tăng mỗi lần lưu. App so `version` để biết có kịch bản mới. `schema` chỉ tăng khi cấu trúc dữ liệu đổi và cần bản app mới.
- `index.html`, `editor.js`, `editor.css`: trang sửa kịch bản, chạy hoàn toàn trên trình duyệt.
- `import.html`, `import.js`, `mau-import.json`: trang file JSON và file mẫu.
- `common.js`: phần kiểm tra lỗi và lưu lên GitHub dùng chung cho hai trang.

## Sửa kịch bản

1. Mở trang web, bấm **Cài đặt GitHub**, nhập fine-grained token chỉ có quyền `Contents: Read and write` cho repo này.
2. Bấm **Tải lại** để lấy bản mới nhất từ GitHub.
3. Sửa nhân vật, màn, tình huống, lựa chọn và hành động.
4. Bấm **Lưu lên GitHub**. Trang kiểm tra lỗi trước, rồi commit `events.json` và tăng `version` trong `manifest.json`.
5. Hostinger tự deploy lại khi nhánh `main` có commit mới.

## File JSON

Mọi việc với file JSON nằm ở trang `import.html` (nút **File JSON** trên trang sửa): tải file mẫu, tải kịch bản hiện tại về máy, và tải file lên.

Khi tải file lên, trang tự nhận loại file:

- File có `actions` hoặc `rules` (như `events.json` tải về) là kịch bản đầy đủ và thay toàn bộ. Mục không có trong file sẽ bị xoá, trang hỏi lại trước khi lưu.
- File khác là một phần kịch bản và được gộp vào bản hiện tại, không xoá gì. Xem `mau-import.json`.
  - Nhân vật khớp theo `id`. Đã có thì cập nhật các trường có trong file, chưa có thì thêm.
  - Màn khớp theo `title`. Chưa có thì thêm màn mới vào cuối.
  - Tình huống khớp theo `title` trên toàn kịch bản. Đã có thì thay tại chỗ cũ, chưa có thì thêm vào màn hoặc `randomPool` ghi trong file.
- Danh sách động tác luôn giữ nguyên.

Trang kiểm tra lỗi trên bản kết quả và liệt kê từng mục thêm mới, cập nhật, xoá hay không đổi. Khi lưu, trang tải lại bản mới nhất trên GitHub rồi làm lại để không mất sửa đổi của người khác.

## Số tình huống mỗi màn

- Màn cố định chơi đủ số tình huống có trong màn đó. Hiện là 4, 4, 5, 5, 6.
- Màn random lấy số tình huống theo `rules.randomStageEvents`, hiện là 6, 6, 7, 7, 8. Hết danh sách thì dùng số cuối. Bản app cũ chỉ đọc `rules.eventsPerRandomStage`.
- Tổng số tình huống trong `randomPool` quyết định có bao nhiêu màn random. Hết kho thì người chơi đắc đạo.

## Giới hạn

- Công đức mỗi lựa chọn từ 1 đến 6, khẩu nghiệp từ 5 đến 45.
- Danh sách động tác do code trong game quyết định. Thêm động tác mới cần ra bản app mới và tăng `schema`.
