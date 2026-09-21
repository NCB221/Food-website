from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Literal, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from anh import THU_MUC_UPLOAD, luu_anh, xoa_anh
from database import ket_noi, khoi_tao_db

THU_MUC_GOC = Path(__file__).parent


@asynccontextmanager
async def lifespan(app: FastAPI):
    so_dong = khoi_tao_db()
    if so_dong:
        print(f"Da nang cap {so_dong} dong du lieu tu cau truc cu sang cau truc moi.")
    yield


app = FastAPI(title="Food Review API", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=THU_MUC_GOC / "static"), name="static")

# Ảnh nằm trên đĩa và được trả trực tiếp như file tĩnh -> trình duyệt cache được,
# không phải đi qua Python mỗi lần hiển thị.
THU_MUC_UPLOAD.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=THU_MUC_UPLOAD), name="uploads")


# ---------- Cấu trúc dữ liệu ----------
class QuanIn(BaseModel):
    ten: str = Field(..., min_length=1, description="Tên quán")
    loai: Literal["an", "uong"] = Field(..., description="'an' hoặc 'uong'")
    dia_chi: str = Field(..., min_length=1, description="Địa chỉ quán")
    mo_ta: str = Field("", description="Mô tả ngắn về quán")


class Quan(QuanIn):
    id: int
    ngay_tao: str
    anh: Optional[str] = None
    # Ảnh của món đầu tiên có ảnh trong menu. Dùng làm ảnh minh hoạ cho thẻ quán
    # khi quán chưa có ảnh bìa riêng.
    anh_mon: Optional[str] = None
    so_review: int = 0
    diem_trung_binh: float = 0


class MonAnIn(BaseModel):
    ten_mon: str = Field(..., min_length=1)
    gia: Optional[int] = Field(None, ge=0)
    mo_ta: str = Field("")


class MonAn(MonAnIn):
    id: int
    quan_id: int
    anh: Optional[str] = None


class ReviewIn(BaseModel):
    nguoi_viet: str = Field("Ẩn danh", description="Tên người viết")
    diem: int = Field(..., ge=1, le=5)
    noi_dung: str = Field("", description="Nội dung bài review")


class Review(ReviewIn):
    id: int
    quan_id: int
    ngay_tao: str


class ChiTietQuan(Quan):
    menu: List[MonAn] = []
    reviews: List[Review] = []


# Dùng lại ở nhiều chỗ: lấy quán kèm số review và điểm trung bình
SQL_QUAN_KEM_DIEM = """
    SELECT q.*,
           COUNT(r.id)                        AS so_review,
           COALESCE(ROUND(AVG(r.diem), 1), 0) AS diem_trung_binh,
           (SELECT m.anh FROM menu_items m
             WHERE m.quan_id = q.id AND m.anh IS NOT NULL
             ORDER BY m.id LIMIT 1)           AS anh_mon
    FROM quan q
    LEFT JOIN reviews r ON r.quan_id = q.id
    {dieu_kien}
    GROUP BY q.id
    {sap_xep}
"""


def _bay_gio() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _kiem_tra_quan_ton_tai(conn, quan_id: int) -> None:
    if not conn.execute("SELECT 1 FROM quan WHERE id = ?", (quan_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Không tìm thấy quán")


def _lay_quan(conn, quan_id: int):
    return conn.execute(
        SQL_QUAN_KEM_DIEM.format(dieu_kien="WHERE q.id = ?", sap_xep=""),
        (quan_id,),
    ).fetchone()


# ---------- Giao diện ----------
def _phien_ban_static() -> str:
    """Mốc thời gian sửa file tĩnh gần nhất, dùng làm số hiệu phiên bản.

    Gắn vào URL của CSS/JS (?v=...) nên mỗi lần sửa file là trình duyệt
    buộc phải tải bản mới, không dùng lại bản cũ trong cache.
    """
    thu_muc_static = THU_MUC_GOC / "static"
    moc = max(f.stat().st_mtime for f in thu_muc_static.glob("*.*"))
    return str(int(moc))


@app.get("/", response_class=HTMLResponse)
def read_root():
    html = (THU_MUC_GOC / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(
        html.replace("__V__", _phien_ban_static()),
        # Trang HTML luôn phải hỏi lại máy chủ, nếu không trình duyệt
        # có thể dùng bản cũ và không bao giờ thấy số hiệu phiên bản mới.
        headers={"Cache-Control": "no-cache"},
    )


# ---------- API: Quán ----------
@app.get("/api/quan", response_model=List[Quan])
def danh_sach_quan(loai: Optional[Literal["an", "uong"]] = None):
    """Danh sách quán kèm số review và điểm trung bình. Lọc theo loại nếu có."""
    with ket_noi() as conn:
        if loai:
            rows = conn.execute(
                SQL_QUAN_KEM_DIEM.format(
                    dieu_kien="WHERE q.loai = ?", sap_xep="ORDER BY q.id DESC"
                ),
                (loai,),
            ).fetchall()
        else:
            rows = conn.execute(
                SQL_QUAN_KEM_DIEM.format(dieu_kien="", sap_xep="ORDER BY q.id DESC")
            ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/quan", response_model=Quan, status_code=201)
def them_quan(quan: QuanIn):
    """Thêm quán mới."""
    ngay_tao = _bay_gio()
    with ket_noi() as conn:
        cur = conn.execute(
            """INSERT INTO quan (ten, loai, dia_chi, mo_ta, ngay_tao)
               VALUES (?, ?, ?, ?, ?)""",
            (quan.ten, quan.loai, quan.dia_chi, quan.mo_ta, ngay_tao),
        )
        quan_id = cur.lastrowid
    return {
        "id": quan_id,
        "ngay_tao": ngay_tao,
        "so_review": 0,
        "diem_trung_binh": 0,
        "anh_mon": None,
        **quan.model_dump(),
    }


@app.get("/api/quan/{quan_id}", response_model=ChiTietQuan)
def chi_tiet_quan(quan_id: int):
    """Chi tiết 1 quán: thông tin + menu + toàn bộ review."""
    with ket_noi() as conn:
        row = _lay_quan(conn, quan_id)
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy quán")

        menu = conn.execute(
            "SELECT * FROM menu_items WHERE quan_id = ? ORDER BY id", (quan_id,)
        ).fetchall()
        reviews = conn.execute(
            "SELECT * FROM reviews WHERE quan_id = ? ORDER BY id DESC", (quan_id,)
        ).fetchall()

    return {
        **dict(row),
        "menu": [dict(m) for m in menu],
        "reviews": [dict(r) for r in reviews],
    }


@app.put("/api/quan/{quan_id}", response_model=Quan)
def sua_quan(quan_id: int, quan: QuanIn):
    """Cập nhật thông tin quán."""
    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        conn.execute(
            "UPDATE quan SET ten = ?, loai = ?, dia_chi = ?, mo_ta = ? WHERE id = ?",
            (quan.ten, quan.loai, quan.dia_chi, quan.mo_ta, quan_id),
        )
        row = _lay_quan(conn, quan_id)
    return dict(row)


@app.delete("/api/quan/{quan_id}", status_code=204)
def xoa_quan(quan_id: int):
    """Xoá quán. Menu và review bị xoá theo (CASCADE), file ảnh xoá thủ công."""
    with ket_noi() as conn:
        # Phải lấy tên file TRƯỚC khi xoá: CASCADE xoá dòng trong database
        # nhưng không biết gì về file trên đĩa, để sót là thành file rác.
        hang = conn.execute("SELECT anh FROM quan WHERE id = ?", (quan_id,)).fetchone()
        if not hang:
            raise HTTPException(status_code=404, detail="Không tìm thấy quán")
        anh_can_xoa = [hang["anh"]] + [
            r["anh"]
            for r in conn.execute(
                "SELECT anh FROM menu_items WHERE quan_id = ?", (quan_id,)
            )
        ]
        conn.execute("DELETE FROM quan WHERE id = ?", (quan_id,))

    # Chỉ xoá file sau khi database commit thành công
    for ten in anh_can_xoa:
        xoa_anh(ten)


# ---------- API: Menu ----------
@app.post("/api/quan/{quan_id}/menu", response_model=MonAn, status_code=201)
def them_mon(quan_id: int, mon: MonAnIn):
    """Thêm món vào menu của quán."""
    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        cur = conn.execute(
            "INSERT INTO menu_items (quan_id, ten_mon, gia, mo_ta) VALUES (?, ?, ?, ?)",
            (quan_id, mon.ten_mon, mon.gia, mon.mo_ta),
        )
        mon_id = cur.lastrowid
    return {"id": mon_id, "quan_id": quan_id, **mon.model_dump()}


@app.delete("/api/menu/{mon_id}", status_code=204)
def xoa_mon(mon_id: int):
    """Xoá một món khỏi menu, kèm file ảnh của món."""
    with ket_noi() as conn:
        hang = conn.execute(
            "SELECT anh FROM menu_items WHERE id = ?", (mon_id,)
        ).fetchone()
        if not hang:
            raise HTTPException(status_code=404, detail="Không tìm thấy món")
        conn.execute("DELETE FROM menu_items WHERE id = ?", (mon_id,))
    xoa_anh(hang["anh"])


# ---------- API: Ảnh ----------
# Tên bảng không thể truyền qua tham số "?" của SQL nên phải ghép chuỗi.
# Chỉ cho phép đúng 2 giá trị này để tên bảng không bao giờ đến từ người dùng.
BANG_CO_ANH = ("quan", "menu_items")


async def _gan_anh(bang: str, ban_ghi_id: int, file: UploadFile, tien_to: str) -> dict:
    """Lưu ảnh mới cho 1 bản ghi, xoá ảnh cũ nếu có. Dùng chung cho quán và món."""
    assert bang in BANG_CO_ANH
    with ket_noi() as conn:
        hang = conn.execute(
            f"SELECT anh FROM {bang} WHERE id = ?", (ban_ghi_id,)
        ).fetchone()
        if not hang:
            raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi")
        anh_cu = hang["anh"]

    ten_moi = await luu_anh(file, f"{tien_to}{ban_ghi_id}")

    try:
        with ket_noi() as conn:
            conn.execute(
                f"UPDATE {bang} SET anh = ? WHERE id = ?", (ten_moi, ban_ghi_id)
            )
    except Exception:
        # Ghi database hỏng -> bỏ luôn file vừa lưu, tránh để lại file mồ côi
        xoa_anh(ten_moi)
        raise

    xoa_anh(anh_cu)  # thay ảnh thì ảnh cũ không còn ai dùng
    return {"anh": ten_moi}


def _go_anh(bang: str, ban_ghi_id: int) -> None:
    assert bang in BANG_CO_ANH
    with ket_noi() as conn:
        hang = conn.execute(
            f"SELECT anh FROM {bang} WHERE id = ?", (ban_ghi_id,)
        ).fetchone()
        if not hang:
            raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi")
        conn.execute(f"UPDATE {bang} SET anh = NULL WHERE id = ?", (ban_ghi_id,))
    xoa_anh(hang["anh"])


@app.post("/api/quan/{quan_id}/anh")
async def tai_anh_quan(quan_id: int, file: UploadFile = File(...)):
    """Tải ảnh đại diện cho quán. Ảnh cũ (nếu có) sẽ bị thay thế."""
    return await _gan_anh("quan", quan_id, file, "quan")


@app.delete("/api/quan/{quan_id}/anh", status_code=204)
def xoa_anh_quan(quan_id: int):
    _go_anh("quan", quan_id)


@app.post("/api/menu/{mon_id}/anh")
async def tai_anh_mon(mon_id: int, file: UploadFile = File(...)):
    """Tải ảnh cho một món trong menu. Ảnh cũ (nếu có) sẽ bị thay thế."""
    return await _gan_anh("menu_items", mon_id, file, "mon")


@app.delete("/api/menu/{mon_id}/anh", status_code=204)
def xoa_anh_mon(mon_id: int):
    _go_anh("menu_items", mon_id)


# ---------- API: Review ----------
@app.post("/api/quan/{quan_id}/reviews", response_model=Review, status_code=201)
def them_review(quan_id: int, review: ReviewIn):
    """Thêm bài review cho quán."""
    ngay_tao = _bay_gio()
    nguoi_viet = review.nguoi_viet.strip() or "Ẩn danh"
    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        cur = conn.execute(
            """INSERT INTO reviews (quan_id, nguoi_viet, diem, noi_dung, ngay_tao)
               VALUES (?, ?, ?, ?, ?)""",
            (quan_id, nguoi_viet, review.diem, review.noi_dung, ngay_tao),
        )
        review_id = cur.lastrowid
    return {
        "id": review_id,
        "quan_id": quan_id,
        "ngay_tao": ngay_tao,
        **{**review.model_dump(), "nguoi_viet": nguoi_viet},
    }


@app.delete("/api/reviews/{review_id}", status_code=204)
def xoa_review(review_id: int):
    """Xoá một bài review."""
    with ket_noi() as conn:
        cur = conn.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Không tìm thấy review")


# ---------- API: Thống kê ----------
@app.get("/api/thong-ke")
def thong_ke():
    """Số quán theo từng loại, dùng cho 2 ô ở trang chủ."""
    with ket_noi() as conn:
        rows = conn.execute(
            "SELECT loai, COUNT(*) AS so_luong FROM quan GROUP BY loai"
        ).fetchall()
        tong_review = conn.execute("SELECT COUNT(*) AS n FROM reviews").fetchone()["n"]
    dem = {r["loai"]: r["so_luong"] for r in rows}
    return {
        "quan_an": dem.get("an", 0),
        "quan_uong": dem.get("uong", 0),
        "tong_review": tong_review,
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
