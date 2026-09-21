# Food Review

Ứng dụng web lưu và đánh giá các địa điểm ăn uống, viết bằng **FastAPI** (backend) + **SQLite** (database) + **HTML/Bootstrap 5** (frontend).

## Luồng sử dụng

```
Trang chủ                 Danh sách quán            Chi tiết quán
┌──────────┬──────────┐   ┌────────────────────┐   ┌────────────────────┐
│ 🍜 Quán  │ 🧋 Quán  │ → │ Quán A  ⭐⭐⭐⭐    │ → │ 📍 Địa chỉ         │
│    ăn    │  đồ uống │   │ Quán B  ⭐⭐⭐      │   │ 📋 Menu            │
└──────────┴──────────┘   │ [+ Thêm quán mới]  │   │ ✍️ Bài review      │
                          └────────────────────┘   └────────────────────┘
```

1. **Trang chủ** — 2 ô: Quán ăn và Quán đồ uống, mỗi ô hiện số địa điểm đã lưu
2. **Bấm vào 1 ô** — xem danh sách các quán thuộc loại đó, kèm nút thêm quán mới
3. **Bấm vào 1 quán** — xem địa chỉ, menu và toàn bộ bài review; thêm món / viết review tại đây

Ở form **“+ Thêm quán mới”** có thêm phần *Ảnh minh hoạ một món*: chọn tên món và
một file ảnh, ảnh hiện ngay để xem trước. Khi bấm **Lưu**, ứng dụng lần lượt tạo quán,
thêm món đó vào menu rồi gắn ảnh vào món — ảnh này cũng được dùng làm ảnh đại diện
cho thẻ quán ở màn danh sách khi quán chưa có ảnh bìa riêng.

## Tính năng

- Thêm, sửa, xoá quán (tên, loại, địa chỉ, mô tả)
- Quản lý menu của từng quán (tên món, giá, ghi chú)
- Viết nhiều bài review cho mỗi quán (người viết, 1-5 sao, nội dung)
- Khi thêm quán mới, tải luôn **1 ảnh minh hoạ một món** của quán (có xem trước)
- Tải ảnh cho quán và cho từng món trong menu (tự nén, tự xoá khi xoá dữ liệu)
- Tự tính điểm trung bình và số lượng review cho mỗi quán
- Xoá quán sẽ tự xoá menu và review của quán đó

## Cài đặt

```powershell
cd Food_review
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> Nếu `.venv\Scripts\activate` báo lỗi *"running scripts is disabled"*, cứ gọi thẳng
> `.venv\Scripts\python.exe` như trên — không cần activate.

## Chạy

```powershell
.venv\Scripts\python.exe main.py
```

Mở trình duyệt tại http://127.0.0.1:8000

Tài liệu API tự động: http://127.0.0.1:8000/docs

## Cấu trúc thư mục

```
Food_review/
├── main.py                     # Backend FastAPI, toàn bộ router API
├── database.py                 # Kết nối SQLite, định nghĩa 3 bảng
├── anh.py                      # Kiểm tra, nén và lưu ảnh tải lên
├── chuyen_json_sang_sqlite.py  # Chuyển dữ liệu JSON cũ sang SQLite (chạy 1 lần)
├── index.html                  # 3 màn hình: trang chủ / danh sách / chi tiết
├── requirements.txt
├── data/
│   ├── food_review.db          # Database SQLite (dữ liệu thật)
│   └── reviews.json            # File JSON cũ, giữ lại để tham khảo
├── uploads/                    # Ảnh người dùng tải lên (không đưa lên git)
└── static/
    ├── script.js               # Điều hướng màn hình, gọi API, render
    └── style.css               # CSS tuỳ chỉnh
```

## Ảnh

Ảnh **lưu thành file trong `uploads/`**, database chỉ giữ tên file ở cột `anh`.
Cách này giúp trình duyệt cache được ảnh và file database luôn nhẹ.

Khi tải lên, ảnh được xử lý tự động:

| Bước | Chi tiết |
|---|---|
| Giới hạn dung lượng | Tối đa 8 MB, vượt thì trả lỗi 413 |
| Kiểm tra thật/giả | Mở bằng Pillow, không tin phần mở rộng file |
| Xoay đúng chiều | Theo thông tin EXIF của máy ảnh |
| Nền trong suốt | PNG/GIF được ghép lên nền trắng |
| Thu nhỏ | Cạnh dài tối đa 1200px, lưu JPEG chất lượng 85 |
| Đặt tên | Ngẫu nhiên (`quan3_a1b2c3d4.jpg`), không dùng tên gốc |

Ảnh 3000×2000 px (95 KB) sau xử lý còn 1200×800 px (5,9 KB).

File ảnh được xoá tự động khi: đổi ảnh khác, bấm xoá ảnh, xoá món, hoặc xoá quán.

## Database

Dữ liệu lưu trong SQLite tại `data/food_review.db`, gồm 3 bảng có quan hệ:

```
quan (1) ──< menu_items (n)
     (1) ──< reviews    (n)
```

**Bảng `quan`** — địa điểm ăn uống

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `ten` | TEXT | NOT NULL |
| `loai` | TEXT | NOT NULL, CHECK IN ('an','uong') |
| `dia_chi` | TEXT | NOT NULL |
| `mo_ta` | TEXT | NOT NULL, mặc định rỗng |
| `anh` | TEXT | Tên file trong `uploads/`, cho phép NULL |
| `ngay_tao` | TEXT | NOT NULL |

> API `GET /api/quan` trả thêm trường **`anh_mon`** (không lưu trong bảng): ảnh của
> món đầu tiên có ảnh trong menu, dùng làm ảnh minh hoạ cho thẻ quán khi cột `anh`
> còn trống.

**Bảng `menu_items`** — món trong menu của quán

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `quan_id` | INTEGER | NOT NULL, FK → quan(id), ON DELETE CASCADE |
| `ten_mon` | TEXT | NOT NULL |
| `gia` | INTEGER | CHECK >= 0, cho phép NULL |
| `mo_ta` | TEXT | NOT NULL, mặc định rỗng |
| `anh` | TEXT | Tên file trong `uploads/`, cho phép NULL |

**Bảng `reviews`** — bài đánh giá của quán

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `quan_id` | INTEGER | NOT NULL, FK → quan(id), ON DELETE CASCADE |
| `nguoi_viet` | TEXT | NOT NULL, mặc định 'Ẩn danh' |
| `diem` | INTEGER | NOT NULL, CHECK 1-5 |
| `noi_dung` | TEXT | NOT NULL, mặc định rỗng |
| `ngay_tao` | TEXT | NOT NULL |

Bảng được tạo tự động khi khởi động app. Nếu phát hiện database theo cấu trúc cũ
(bảng `reviews` phẳng), app sẽ tự nâng cấp sang cấu trúc mới và giữ lại bảng cũ
dưới tên `reviews_cu`.

Xem dữ liệu trực tiếp:

```powershell
.venv\Scripts\python.exe -c "import sqlite3; c=sqlite3.connect('data/food_review.db'); [print(dict(zip([d[0] for d in c.execute('SELECT * FROM quan').description], r))) for r in c.execute('SELECT * FROM quan')]"
```

## API

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/` | Giao diện chính |
| GET | `/api/quan` | Danh sách tất cả quán |
| GET | `/api/quan?loai=an` | Lọc theo loại (`an` hoặc `uong`) |
| POST | `/api/quan` | Thêm quán mới |
| GET | `/api/quan/{id}` | Chi tiết quán (kèm menu + reviews) |
| PUT | `/api/quan/{id}` | Cập nhật thông tin quán |
| DELETE | `/api/quan/{id}` | Xoá quán (cascade menu + reviews) |
| POST | `/api/quan/{id}/menu` | Thêm món vào menu |
| DELETE | `/api/menu/{id}` | Xoá món khỏi menu |
| POST | `/api/quan/{id}/reviews` | Viết bài review cho quán |
| DELETE | `/api/reviews/{id}` | Xoá bài review |
| POST | `/api/quan/{id}/anh` | Tải ảnh cho quán (multipart, field `file`) |
| DELETE | `/api/quan/{id}/anh` | Xoá ảnh của quán |
| POST | `/api/menu/{id}/anh` | Tải ảnh cho món |
| DELETE | `/api/menu/{id}/anh` | Xoá ảnh của món |
| GET | `/api/thong-ke` | Số quán mỗi loại + tổng số review |
