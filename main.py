import time
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Literal, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
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


# ---------- An ninh: header và giới hạn tần suất ----------
# script-src còn phải mở 'unsafe-inline' vì giao diện dùng thuộc tính onclick.
# Dù vậy CSP vẫn chặn được việc nạp mã từ máy chủ lạ, là đường tấn công chính.
CSP = (
    "default-src 'self'; "
    "img-src 'self' data:; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'"
)

HEADER_AN_NINH = {
    "Content-Security-Policy": CSP,
    # Trình duyệt không được tự đoán kiểu file khác với Content-Type khai báo
    "X-Content-Type-Options": "nosniff",
    # Không cho nhúng trang vào iframe của site khác (chống clickjacking)
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


@app.middleware("http")
async def them_header_an_ninh(request: Request, call_next):
    phan_hoi = await call_next(request)
    for ten, gia_tri in HEADER_AN_NINH.items():
        phan_hoi.headers.setdefault(ten, gia_tri)
    return phan_hoi


# Chặn kịch bản một máy gửi dồn dập request ghi. Bộ đếm nằm trong bộ nhớ nên
# chỉ đúng khi chạy 1 tiến trình - đủ cho quy mô hiện tại của ứng dụng.
GIOI_HAN_GHI = 60          # số request ghi tối đa...
CUA_SO_GIAY = 60           # ...trong mỗi khoảng thời gian này
PHUONG_THUC_GHI = {"POST", "PUT", "PATCH", "DELETE"}
_lich_su_ghi: dict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def gioi_han_tan_suat(request: Request, call_next):
    if request.method not in PHUONG_THUC_GHI:
        return await call_next(request)

    ip = request.client.host if request.client else "khong-ro"
    bay_gio = time.monotonic()
    moc = _lich_su_ghi[ip]
    # Bỏ các mốc đã ra khỏi cửa sổ thời gian, tránh danh sách phình vô hạn
    moc[:] = [t for t in moc if bay_gio - t < CUA_SO_GIAY]

    if len(moc) >= GIOI_HAN_GHI:
        return JSONResponse(
            status_code=429,
            content={"detail": "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút."},
            headers=HEADER_AN_NINH,
        )

    moc.append(bay_gio)
    return await call_next(request)
app.mount("/static", StaticFiles(directory=THU_MUC_GOC / "static"), name="static")

# Ảnh nằm trên đĩa và được trả trực tiếp như file tĩnh -> trình duyệt cache được,
# không phải đi qua Python mỗi lần hiển thị.
THU_MUC_UPLOAD.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=THU_MUC_UPLOAD), name="uploads")


# ---------- Cấu trúc dữ liệu ----------
# Chặn ngay ở tầng kiểm tra dữ liệu: không có max_length thì một request đơn lẻ
# có thể nhét vài triệu ký tự vào database.
DAI_TEN = 200
DAI_DIA_CHI = 300
DAI_MO_TA = 2000
DAI_NOI_DUNG = 5000
# Giá cao nhất chấp nhận được (1 tỷ đồng) - chặn số vô nghĩa
GIA_TOI_DA = 1_000_000_000


class QuanIn(BaseModel):
    ten: str = Field(..., min_length=1, max_length=DAI_TEN, description="Tên quán")
    loai: Literal["an", "uong"] = Field(..., description="'an' hoặc 'uong'")
    dia_chi: str = Field(
        ..., min_length=1, max_length=DAI_DIA_CHI, description="Địa chỉ quán"
    )
    mo_ta: str = Field(
        "", max_length=DAI_MO_TA, description="Mô tả ngắn về quán"
    )


class Quan(QuanIn):
    id: int
    ngay_tao: str
    anh: Optional[str] = None
    # Ảnh của món đầu tiên có ảnh trong menu. Dùng làm ảnh minh hoạ cho thẻ quán
    # khi quán chưa có ảnh bìa riêng.
    anh_mon: Optional[str] = None
    so_review: int = 0
    diem_trung_binh: float = 0
    so_anh: int = 0
    # Trích bài review mới nhất, hiển thị ngay trên thẻ quán ở danh sách
    review_nguoi_viet: Optional[str] = None
    review_noi_dung: Optional[str] = None


class MonAnIn(BaseModel):
    ten_mon: str = Field(..., min_length=1, max_length=DAI_TEN)
    gia: Optional[int] = Field(None, ge=0, le=GIA_TOI_DA)
    mo_ta: str = Field("", max_length=DAI_MO_TA)


class MonAn(MonAnIn):
    id: int
    quan_id: int
    anh: Optional[str] = None


class ReviewIn(BaseModel):
    nguoi_viet: str = Field(
        "Ẩn danh", max_length=DAI_TEN, description="Tên người viết"
    )
    diem: int = Field(..., ge=1, le=5)
    noi_dung: str = Field(
        "", max_length=DAI_NOI_DUNG, description="Nội dung bài review"
    )


class Review(ReviewIn):
    id: int
    quan_id: int
    ngay_tao: str
    # NULL khi bài review chưa từng được sửa
    ngay_cap_nhat: Optional[str] = None


class AnhQuan(BaseModel):
    id: int
    quan_id: int
    ten_file: str
    chu_thich: str = ""
    ngay_tao: str


class ChiTietQuan(Quan):
    menu: List[MonAn] = []
    reviews: List[Review] = []
    thu_vien: List[AnhQuan] = []


# Dùng lại ở nhiều chỗ: lấy quán kèm số review và điểm trung bình
SQL_QUAN_KEM_DIEM = """
    SELECT q.*,
           COUNT(r.id)                        AS so_review,
           COALESCE(ROUND(AVG(r.diem), 1), 0) AS diem_trung_binh,
           (SELECT m.anh FROM menu_items m
             WHERE m.quan_id = q.id AND m.anh IS NOT NULL
             ORDER BY m.id LIMIT 1)           AS anh_mon,
           (SELECT COUNT(*) FROM anh_quan a
             WHERE a.quan_id = q.id)          AS so_anh,
           -- Trích bài review mới nhất để hiện ngay trên thẻ ngoài danh sách
           (SELECT r2.nguoi_viet FROM reviews r2
             WHERE r2.quan_id = q.id ORDER BY r2.id DESC LIMIT 1) AS review_nguoi_viet,
           (SELECT r2.noi_dung FROM reviews r2
             WHERE r2.quan_id = q.id ORDER BY r2.id DESC LIMIT 1) AS review_noi_dung
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
        thu_vien = conn.execute(
            "SELECT * FROM anh_quan WHERE quan_id = ? ORDER BY id", (quan_id,)
        ).fetchall()

    return {
        **dict(row),
        "menu": [dict(m) for m in menu],
        "reviews": [dict(r) for r in reviews],
        "thu_vien": [dict(a) for a in thu_vien],
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
        anh_can_xoa = (
            [hang["anh"]]
            + [
                r["anh"]
                for r in conn.execute(
                    "SELECT anh FROM menu_items WHERE quan_id = ?", (quan_id,)
                )
            ]
            + [
                r["ten_file"]
                for r in conn.execute(
                    "SELECT ten_file FROM anh_quan WHERE quan_id = ?", (quan_id,)
                )
            ]
        )
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


@app.put("/api/menu/{mon_id}", response_model=MonAn)
def sua_mon(mon_id: int, mon: MonAnIn):
    """Sửa tên, giá hoặc ghi chú của một món. Ảnh giữ nguyên."""
    with ket_noi() as conn:
        cur = conn.execute(
            "UPDATE menu_items SET ten_mon = ?, gia = ?, mo_ta = ? WHERE id = ?",
            (mon.ten_mon, mon.gia, mon.mo_ta, mon_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Không tìm thấy món")
        row = conn.execute(
            "SELECT * FROM menu_items WHERE id = ?", (mon_id,)
        ).fetchone()
    return dict(row)


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
BANG_CO_ANH = ("menu_items",)

# Không giới hạn thì một request có thể nhét hàng nghìn ảnh và làm đầy đĩa
SO_ANH_TOI_DA_MOI_LAN = 20
SO_ANH_TOI_DA_MOI_QUAN = 100


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


@app.delete("/api/quan/{quan_id}/anh", status_code=204)
def bo_anh_bia(quan_id: int):
    """Bỏ ảnh bìa của quán.

    KHÔNG xoá file: ảnh bìa luôn là một ảnh trong thư viện, xoá file ở đây
    sẽ làm hỏng ảnh đó trong thư viện. Muốn xoá hẳn thì dùng
    DELETE /api/thu-vien/{anh_id}.
    """
    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        conn.execute("UPDATE quan SET anh = NULL WHERE id = ?", (quan_id,))


@app.post("/api/menu/{mon_id}/anh")
async def tai_anh_mon(mon_id: int, file: UploadFile = File(...)):
    """Tải ảnh cho một món trong menu. Ảnh cũ (nếu có) sẽ bị thay thế."""
    return await _gan_anh("menu_items", mon_id, file, "mon")


@app.delete("/api/menu/{mon_id}/anh", status_code=204)
def xoa_anh_mon(mon_id: int):
    _go_anh("menu_items", mon_id)


# ---------- API: Thư viện ảnh của quán ----------
@app.get("/api/quan/{quan_id}/thu-vien", response_model=List[AnhQuan])
def danh_sach_anh_quan(quan_id: int):
    """Toàn bộ ảnh trong thư viện của một quán."""
    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        rows = conn.execute(
            "SELECT * FROM anh_quan WHERE quan_id = ? ORDER BY id", (quan_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/quan/{quan_id}/thu-vien", response_model=List[AnhQuan], status_code=201)
async def them_anh_quan(quan_id: int, files: List[UploadFile] = File(...)):
    """Tải lên một hoặc nhiều ảnh về không gian quán.

    Ảnh đầu tiên của quán tự động trở thành ảnh bìa, để thẻ ngoài danh sách
    có hình ngay mà người dùng không phải thao tác thêm.
    """
    if len(files) > SO_ANH_TOI_DA_MOI_LAN:
        raise HTTPException(
            status_code=413,
            detail=f"Chỉ tải lên tối đa {SO_ANH_TOI_DA_MOI_LAN} ảnh mỗi lần.",
        )

    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        so_hien_co = conn.execute(
            "SELECT COUNT(*) AS n FROM anh_quan WHERE quan_id = ?", (quan_id,)
        ).fetchone()["n"]
    if so_hien_co + len(files) > SO_ANH_TOI_DA_MOI_QUAN:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Mỗi quán chỉ lưu tối đa {SO_ANH_TOI_DA_MOI_QUAN} ảnh "
                f"(hiện có {so_hien_co})."
            ),
        )

    ngay_tao = _bay_gio()
    da_luu: List[str] = []
    try:
        for f in files:
            da_luu.append(await luu_anh(f, f"quan{quan_id}"))
    except Exception:
        # Một file hỏng giữa chừng -> bỏ hết, không để lại ảnh mồ côi trên đĩa
        for ten in da_luu:
            xoa_anh(ten)
        raise

    try:
        with ket_noi() as conn:
            for ten in da_luu:
                conn.execute(
                    """INSERT INTO anh_quan (quan_id, ten_file, chu_thich, ngay_tao)
                       VALUES (?, ?, '', ?)""",
                    (quan_id, ten, ngay_tao),
                )
            chua_co_bia = conn.execute(
                "SELECT anh FROM quan WHERE id = ?", (quan_id,)
            ).fetchone()["anh"] is None
            if chua_co_bia:
                conn.execute(
                    "UPDATE quan SET anh = ? WHERE id = ?", (da_luu[0], quan_id)
                )
            rows = conn.execute(
                "SELECT * FROM anh_quan WHERE quan_id = ? ORDER BY id", (quan_id,)
            ).fetchall()
    except Exception:
        for ten in da_luu:
            xoa_anh(ten)
        raise

    return [dict(r) for r in rows]


@app.put("/api/quan/{quan_id}/anh-bia/{anh_id}", response_model=Quan)
def chon_anh_bia(quan_id: int, anh_id: int):
    """Chọn một ảnh trong thư viện làm ảnh bìa của quán."""
    with ket_noi() as conn:
        _kiem_tra_quan_ton_tai(conn, quan_id)
        hang = conn.execute(
            "SELECT ten_file FROM anh_quan WHERE id = ? AND quan_id = ?",
            (anh_id, quan_id),
        ).fetchone()
        if not hang:
            raise HTTPException(
                status_code=404, detail="Ảnh không thuộc thư viện của quán này"
            )
        conn.execute(
            "UPDATE quan SET anh = ? WHERE id = ?", (hang["ten_file"], quan_id)
        )
        row = _lay_quan(conn, quan_id)
    return dict(row)


@app.delete("/api/thu-vien/{anh_id}", status_code=204)
def xoa_anh_thu_vien(anh_id: int):
    """Xoá một ảnh khỏi thư viện, kèm file trên đĩa."""
    with ket_noi() as conn:
        hang = conn.execute(
            "SELECT quan_id, ten_file FROM anh_quan WHERE id = ?", (anh_id,)
        ).fetchone()
        if not hang:
            raise HTTPException(status_code=404, detail="Không tìm thấy ảnh")
        conn.execute("DELETE FROM anh_quan WHERE id = ?", (anh_id,))

        # Ảnh vừa xoá đang là bìa -> lấy ảnh còn lại trong thư viện thay thế,
        # hết ảnh thì để trống chứ không trỏ vào file đã mất.
        quan = conn.execute(
            "SELECT anh FROM quan WHERE id = ?", (hang["quan_id"],)
        ).fetchone()
        if quan and quan["anh"] == hang["ten_file"]:
            con_lai = conn.execute(
                "SELECT ten_file FROM anh_quan WHERE quan_id = ? ORDER BY id LIMIT 1",
                (hang["quan_id"],),
            ).fetchone()
            conn.execute(
                "UPDATE quan SET anh = ? WHERE id = ?",
                (con_lai["ten_file"] if con_lai else None, hang["quan_id"]),
            )

    xoa_anh(hang["ten_file"])


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


@app.put("/api/reviews/{review_id}", response_model=Review)
def sua_review(review_id: int, review: ReviewIn):
    """Sửa bài review. Mỗi lần sửa ghi lại mốc thời gian vào ngay_cap_nhat."""
    ngay_cap_nhat = _bay_gio()
    nguoi_viet = review.nguoi_viet.strip() or "Ẩn danh"
    with ket_noi() as conn:
        cur = conn.execute(
            """UPDATE reviews
                  SET nguoi_viet = ?, diem = ?, noi_dung = ?, ngay_cap_nhat = ?
                WHERE id = ?""",
            (nguoi_viet, review.diem, review.noi_dung, ngay_cap_nhat, review_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Không tìm thấy review")
        row = conn.execute(
            "SELECT * FROM reviews WHERE id = ?", (review_id,)
        ).fetchone()
    return dict(row)


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
