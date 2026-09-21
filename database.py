"""Lớp truy cập dữ liệu SQLite cho Food Review.

Cấu trúc: 1 quán có nhiều món trong menu và nhiều bài review.
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path

# Đường dẫn tuyệt đối để chạy được từ bất kỳ thư mục nào
THU_MUC_GOC = Path(__file__).parent
DB_FILE = THU_MUC_GOC / "data" / "food_review.db"

LOAI_HOP_LE = ("an", "uong")

SCHEMA = """
-- Bảng quán: địa điểm ăn uống
CREATE TABLE IF NOT EXISTS quan (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ten      TEXT    NOT NULL,
    loai     TEXT    NOT NULL CHECK (loai IN ('an', 'uong')),
    dia_chi  TEXT    NOT NULL,
    mo_ta    TEXT    NOT NULL DEFAULT '',
    anh      TEXT,   -- tên file ảnh trong thư mục uploads/, NULL nếu chưa có
    ngay_tao TEXT    NOT NULL
);

-- Bảng menu: các món của một quán
CREATE TABLE IF NOT EXISTS menu_items (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    quan_id INTEGER NOT NULL REFERENCES quan(id) ON DELETE CASCADE,
    ten_mon TEXT    NOT NULL,
    gia     INTEGER          CHECK (gia IS NULL OR gia >= 0),
    mo_ta   TEXT    NOT NULL DEFAULT '',
    anh     TEXT    -- tên file ảnh trong thư mục uploads/, NULL nếu chưa có
);

-- Bảng review: các bài đánh giá của một quán
CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    quan_id    INTEGER NOT NULL REFERENCES quan(id) ON DELETE CASCADE,
    nguoi_viet TEXT    NOT NULL DEFAULT 'Ẩn danh',
    diem       INTEGER NOT NULL CHECK (diem BETWEEN 1 AND 5),
    noi_dung   TEXT    NOT NULL DEFAULT '',
    ngay_tao   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quan_loai       ON quan(loai);
CREATE INDEX IF NOT EXISTS idx_menu_quan       ON menu_items(quan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_quan    ON reviews(quan_id);
CREATE INDEX IF NOT EXISTS idx_reviews_diem    ON reviews(diem);
"""


@contextmanager
def ket_noi():
    """Mở kết nối, tự commit khi xong, tự rollback nếu lỗi, luôn đóng lại."""
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row  # truy cập cột theo tên
    # Bắt buộc bật từng kết nối: SQLite mặc định TẮT ràng buộc khoá ngoại,
    # không bật thì ON DELETE CASCADE sẽ không chạy.
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _la_schema_cu(conn) -> bool:
    """Bảng reviews phiên bản cũ có cột ten_mon và không có quan_id."""
    co_bang = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='reviews'"
    ).fetchone()
    if not co_bang:
        return False
    cot = {r["name"] for r in conn.execute("PRAGMA table_info(reviews)")}
    return "ten_mon" in cot and "quan_id" not in cot


def _nang_cap_tu_schema_cu(conn) -> int:
    """Chuyển dữ liệu từ bảng reviews cũ (mỗi dòng 1 món) sang cấu trúc mới.

    Mỗi tên quán khác nhau trở thành 1 bản ghi trong bảng quan,
    món ăn thành 1 dòng menu, nhận xét thành 1 bài review.
    """
    dong_cu = conn.execute("SELECT * FROM reviews").fetchall()
    conn.execute("ALTER TABLE reviews RENAME TO reviews_cu")
    conn.executescript(SCHEMA)

    quan_da_tao: dict[str, int] = {}
    for r in dong_cu:
        ten_quan = r["quan"]
        if ten_quan not in quan_da_tao:
            cur = conn.execute(
                """INSERT INTO quan (ten, loai, dia_chi, mo_ta, ngay_tao)
                   VALUES (?, 'an', ?, '', ?)""",
                (ten_quan, "Chưa cập nhật địa chỉ", r["ngay_tao"]),
            )
            quan_da_tao[ten_quan] = cur.lastrowid
        quan_id = quan_da_tao[ten_quan]

        conn.execute(
            "INSERT INTO menu_items (quan_id, ten_mon, gia, mo_ta) VALUES (?, ?, ?, '')",
            (quan_id, r["ten_mon"], r["gia"]),
        )
        conn.execute(
            """INSERT INTO reviews (quan_id, nguoi_viet, diem, noi_dung, ngay_tao)
               VALUES (?, 'Ẩn danh', ?, ?, ?)""",
            (quan_id, r["diem"], r["nhan_xet"], r["ngay_tao"]),
        )
    return len(dong_cu)


def _them_cot_neu_thieu(conn, bang: str, cot: str, kieu: str) -> None:
    """Thêm cột vào bảng đã tồn tại. Dùng cho database tạo từ phiên bản trước.

    CREATE TABLE IF NOT EXISTS không đụng tới bảng đã có, nên cột mới
    phải thêm bằng ALTER TABLE.
    """
    cot_hien_co = {r["name"] for r in conn.execute(f"PRAGMA table_info({bang})")}
    if cot not in cot_hien_co:
        conn.execute(f"ALTER TABLE {bang} ADD COLUMN {cot} {kieu}")


def khoi_tao_db() -> int:
    """Tạo bảng nếu chưa có, nâng cấp schema cũ nếu phát hiện.

    Trả về số dòng đã nâng cấp từ schema cũ (0 nếu không có gì để nâng cấp).
    """
    with ket_noi() as conn:
        so_dong = 0
        if _la_schema_cu(conn):
            so_dong = _nang_cap_tu_schema_cu(conn)
        else:
            conn.executescript(SCHEMA)

        # Database tạo trước khi có tính năng ảnh sẽ thiếu 2 cột này
        _them_cot_neu_thieu(conn, "quan", "anh", "TEXT")
        _them_cot_neu_thieu(conn, "menu_items", "anh", "TEXT")

        # WAL: nhiều người ĐỌC song song khi 1 người đang GHI. Chỉ cần đặt 1 lần.
        conn.execute("PRAGMA journal_mode = WAL")
        return so_dong
