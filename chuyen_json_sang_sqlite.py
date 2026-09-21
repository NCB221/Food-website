"""Chuyển dữ liệu từ data/reviews.json (định dạng cũ) sang SQLite.

Định dạng JSON cũ: mỗi dòng là 1 món ăn kèm tên quán.
Cấu trúc mới: mỗi quán là 1 bản ghi, món ăn vào menu, nhận xét thành bài review.
Các dòng có cùng tên quán sẽ được gộp vào 1 quán.

Chạy một lần:  .venv\\Scripts\\python.exe chuyen_json_sang_sqlite.py
An toàn khi chạy lại nhiều lần: dữ liệu đã có sẽ được bỏ qua.
"""

import json
import sys
from pathlib import Path

from database import DB_FILE, ket_noi, khoi_tao_db

FILE_JSON = Path(__file__).parent / "data" / "reviews.json"

# Console Windows mặc định dùng cp1252 -> không in được tiếng Việt.
# Ép stdout sang UTF-8 để tránh UnicodeEncodeError.
sys.stdout.reconfigure(encoding="utf-8")


def lay_hoac_tao_quan(conn, ten_quan: str, ngay_tao: str) -> int:
    """Trả về id của quán, tạo mới nếu chưa có."""
    row = conn.execute("SELECT id FROM quan WHERE ten = ?", (ten_quan,)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute(
        """INSERT INTO quan (ten, loai, dia_chi, mo_ta, ngay_tao)
           VALUES (?, 'an', ?, '', ?)""",
        (ten_quan, "Chưa cập nhật địa chỉ", ngay_tao),
    )
    return cur.lastrowid


def main() -> None:
    if not FILE_JSON.exists():
        print(f"Không tìm thấy {FILE_JSON} - không có gì để chuyển.")
        return

    with open(FILE_JSON, "r", encoding="utf-8") as f:
        du_lieu = json.load(f)

    khoi_tao_db()

    if not du_lieu:
        print("File JSON rỗng - không có gì để chuyển.")
        print(f"Database sẵn sàng tại: {DB_FILE}")
        return

    quan_moi = mon_moi = review_moi = bo_qua = 0

    with ket_noi() as conn:
        for r in du_lieu:
            ten_quan = r["quan"]
            ngay_tao = r.get("ngay_tao", "")

            da_co = conn.execute(
                "SELECT 1 FROM quan WHERE ten = ?", (ten_quan,)
            ).fetchone()
            quan_id = lay_hoac_tao_quan(conn, ten_quan, ngay_tao)
            if not da_co:
                quan_moi += 1

            # Bỏ qua món đã có trong menu của quán này
            trung = conn.execute(
                "SELECT 1 FROM menu_items WHERE quan_id = ? AND ten_mon = ?",
                (quan_id, r["ten_mon"]),
            ).fetchone()
            if trung:
                bo_qua += 1
                continue

            conn.execute(
                "INSERT INTO menu_items (quan_id, ten_mon, gia, mo_ta) VALUES (?, ?, ?, '')",
                (quan_id, r["ten_mon"], r.get("gia")),
            )
            mon_moi += 1

            conn.execute(
                """INSERT INTO reviews (quan_id, nguoi_viet, diem, noi_dung, ngay_tao)
                   VALUES (?, 'Ẩn danh', ?, ?, ?)""",
                (quan_id, r["diem"], r.get("nhan_xet", ""), ngay_tao),
            )
            review_moi += 1

    print(f"Hoàn tất: {quan_moi} quán, {mon_moi} món, {review_moi} bài review.")
    if bo_qua:
        print(f"Bỏ qua {bo_qua} dòng đã có sẵn.")
    print(f"Database: {DB_FILE}")
    print(f"File JSON cũ vẫn được giữ nguyên tại: {FILE_JSON}")


if __name__ == "__main__":
    main()
