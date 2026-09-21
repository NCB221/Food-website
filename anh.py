"""Xử lý ảnh tải lên: kiểm tra, nén, lưu ra thư mục uploads/.

Cách lưu: file ảnh nằm trên đĩa, database chỉ giữ TÊN FILE.
Nhờ vậy trình duyệt cache được ảnh và file database luôn nhẹ.
"""

import io
import secrets
from pathlib import Path
from typing import Optional

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

THU_MUC_GOC = Path(__file__).parent
THU_MUC_UPLOAD = THU_MUC_GOC / "uploads"

# Ảnh điện thoại thường 2-5 MB; 8 MB là dư dùng
DUNG_LUONG_TOI_DA = 8 * 1024 * 1024
# Resize về tối đa 1200px cạnh dài: đủ nét trên web, nhẹ hơn ~95%
CANH_DAI_TOI_DA = 1200
CHAT_LUONG_JPEG = 85


def _bao_dam_thu_muc() -> None:
    THU_MUC_UPLOAD.mkdir(parents=True, exist_ok=True)


async def luu_anh(file: UploadFile, tien_to: str) -> str:
    """Kiểm tra, nén và lưu ảnh. Trả về tên file đã lưu.

    Ném HTTPException nếu file quá lớn hoặc không phải ảnh thật.
    """
    _bao_dam_thu_muc()

    # Đọc dư 1 byte để phát hiện file vượt ngưỡng mà không nạp cả file khổng lồ
    noi_dung = await file.read(DUNG_LUONG_TOI_DA + 1)
    if len(noi_dung) > DUNG_LUONG_TOI_DA:
        raise HTTPException(
            status_code=413,
            detail=f"Ảnh quá lớn. Tối đa {DUNG_LUONG_TOI_DA // 1024 // 1024} MB.",
        )
    if not noi_dung:
        raise HTTPException(status_code=400, detail="File rỗng.")

    # Kiểm tra bằng NỘI DUNG file, không tin vào phần mở rộng hay content-type
    # do trình duyệt gửi lên - cả hai đều có thể bị giả mạo.
    try:
        Image.open(io.BytesIO(noi_dung)).verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="File không phải ảnh hợp lệ (chỉ nhận JPG, PNG, WEBP, GIF...).",
        )

    # verify() làm hỏng đối tượng ảnh nên phải mở lại từ đầu
    img = Image.open(io.BytesIO(noi_dung))
    # Ảnh chụp bằng điện thoại hay bị xoay ngang; EXIF ghi chiều đúng
    img = ImageOps.exif_transpose(img)

    # PNG/GIF có nền trong suốt -> ghép lên nền trắng trước khi lưu JPEG,
    # nếu không phần trong suốt sẽ thành màu đen.
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        nen = Image.new("RGB", img.size, (255, 255, 255))
        nen.paste(img, mask=img.split()[-1])
        img = nen
    else:
        img = img.convert("RGB")

    img.thumbnail((CANH_DAI_TOI_DA, CANH_DAI_TOI_DA))

    # Tên file ngẫu nhiên: không dùng tên gốc người dùng gửi lên để tránh
    # ghi đè lẫn nhau và tránh path traversal (../..).
    ten_file = f"{tien_to}_{secrets.token_hex(8)}.jpg"
    img.save(THU_MUC_UPLOAD / ten_file, "JPEG", quality=CHAT_LUONG_JPEG, optimize=True)
    return ten_file


def xoa_anh(ten_file: Optional[str]) -> None:
    """Xoá file ảnh khỏi đĩa. Bỏ qua nếu không có hoặc file đã mất."""
    if not ten_file:
        return
    # Phòng thủ: chỉ chấp nhận tên file thuần, không có dấu / hay ..
    if "/" in ten_file or "\\" in ten_file or ".." in ten_file:
        return
    (THU_MUC_UPLOAD / ten_file).unlink(missing_ok=True)
