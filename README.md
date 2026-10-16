# Khẩu Nghiệp · kịch bản online

Kho lưu kịch bản cho game Khẩu Nghiệp và trang web để sửa kịch bản.

- `events.json`: nhân vật, động tác, 5 màn cố định và kho tình huống random. Game tải file này.
- `manifest.json`: `version` tăng mỗi lần lưu. App so `version` để biết có kịch bản mới. `schema` chỉ tăng khi cấu trúc dữ liệu đổi và cần bản app mới.
- `index.html`, `editor.js`, `editor.css`: trang sửa kịch bản, chạy hoàn toàn trên trình duyệt.
- `import.html`, `import.js`, `mau-import.json`: trang gộp kịch bản từ file và file mẫu.
- `common.js`: phần kiểm tra lỗi và lưu lên GitHub dùng chung cho hai trang.

## Sửa kịch bản

1. Mở trang web, bấm **Cài đặt GitHub**, nhập fine-grained token chỉ có quyền `Contents: Read and write` cho repo này.
2. Bấm **Tải lại** để lấy bản mới nhất từ GitHub.
3. Sửa nhân vật, màn, tình huống, lựa chọn và hành động.
4. Bấm **Lưu lên GitHub**. Trang kiểm tra lỗi trước, rồi commit `events.json` và tăng `version` trong `manifest.json`.
5. Hostinger tự deploy lại khi nhánh `main` có commit mới.

Không có token thì vẫn xem và sửa được, rồi bấm **Tải file JSON** để lưu về máy.

Muốn thay cả kịch bản bằng một file có sẵn thì bấm **Nhập file JSON** hoặc kéo thả file vào trang. Trang kiểm tra lỗi ngay. Nếu file không có danh sách động tác thì giữ danh sách hiện tại. File nhập chỉ nằm trong trình duyệt cho tới khi bấm **Lưu lên GitHub**.

## Gộp kịch bản từ file

Trang `import.html` (nút **Gộp file JSON**) nhận file chỉ chứa phần muốn thêm hoặc sửa, không thay cả kịch bản. File mẫu là `mau-import.json`.

- Nhân vật khớp theo `id`. Đã có thì cập nhật các trường có trong file, chưa có thì thêm.
- Màn khớp theo `title`. Chưa có thì thêm màn mới vào cuối.
- Tình huống khớp theo `title` trên toàn kịch bản. Đã có thì thay tại chỗ cũ, chưa có thì thêm vào màn hoặc `randomPool` ghi trong file.
- `actions` trong file bị bỏ qua.

Trang kiểm tra lỗi trên bản sau khi gộp và liệt kê từng mục thêm mới, cập nhật hay không đổi. Khi lưu, trang tải lại bản mới nhất trên GitHub rồi gộp lại để không mất sửa đổi của người khác.

## Giới hạn

- Công đức mỗi lựa chọn từ 1 đến 6, khẩu nghiệp từ 5 đến 45.
- Danh sách động tác do code trong game quyết định. Thêm động tác mới cần ra bản app mới và tăng `schema`.
