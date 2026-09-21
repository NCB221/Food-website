// ===================== Trạng thái =====================
const TEN_LOAI = { an: "Quán ăn", uong: "Quán đồ uống" };
const ICON_LOAI = { an: "🍜", uong: "🧋" };

let loaiHienTai = "an";   // loại đang xem ở màn danh sách
let quanHienTai = null;   // id quán đang xem ở màn chi tiết

// Phải khớp với DUNG_LUONG_TOI_DA trong anh.py: chặn sớm ở trình duyệt để
// người dùng biết ngay, không phải chờ tải hết 20 MB lên rồi mới nhận lỗi.
const DUNG_LUONG_ANH_TOI_DA = 8 * 1024 * 1024;
const TEN_MON_MAC_DINH = "Món đặc trưng";

// ===================== Tiện ích =====================

// Chặn HTML injection từ dữ liệu người dùng nhập
function thoat(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
}

function dinhDangGia(gia) {
    return gia === null || gia === undefined
        ? "Chưa rõ giá"
        : `${gia.toLocaleString("vi-VN")} đ`;
}

function veSao(diem) {
    return "⭐".repeat(diem) + "☆".repeat(5 - diem);
}

function hienThongBao(noiDung, loai = "success") {
    const el = document.getElementById("thong-bao");
    el.className = `toast align-items-center text-white border-0 bg-${loai}`;
    document.getElementById("thong-bao-noi-dung").textContent = noiDung;
    bootstrap.Toast.getOrCreateInstance(el, { delay: 3000 }).show();
}

/** Ô ảnh giữ chỗ khi bản ghi chưa có ảnh. */
function khungAnh(tenFile, cao, chuThich) {
    return tenFile
        ? `<img src="/uploads/${encodeURIComponent(tenFile)}" alt="${chuThich}"
                class="anh-bia" style="height:${cao}" loading="lazy">`
        : `<div class="anh-trong d-flex align-items-center justify-content-center"
                style="height:${cao}">🖼️</div>`;
}

/** Gọi API, tự báo lỗi nếu thất bại. Trả về null khi lỗi. */
async function goiApi(url, tuyChon = {}) {
    try {
        const res = await fetch(url, tuyChon);
        if (!res.ok) {
            let chiTiet = `Lỗi ${res.status}`;
            try {
                const loi = await res.json();
                if (loi.detail) {
                    chiTiet = typeof loi.detail === "string"
                        ? loi.detail
                        : "Dữ liệu nhập không hợp lệ";
                }
            } catch { /* body không phải JSON */ }
            hienThongBao(chiTiet, "danger");
            return null;
        }
        return res.status === 204 ? true : await res.json();
    } catch (err) {
        hienThongBao(`Không kết nối được máy chủ: ${err.message}`, "danger");
        return null;
    }
}

/** Hiện đúng 1 màn hình, ẩn các màn còn lại. */
function hienMan(id) {
    ["man-trang-chu", "man-danh-sach", "man-chi-tiet"].forEach(m => {
        document.getElementById(m).hidden = (m !== id);
    });
    window.scrollTo(0, 0);
}

// ===================== Màn 1: Trang chủ =====================

async function moTrangChu() {
    hienMan("man-trang-chu");
    quanHienTai = null;
    await capNhatThongKe();
}

async function capNhatThongKe() {
    const tk = await goiApi("/api/thong-ke");
    if (!tk) return;
    document.getElementById("dem-quan-an").textContent = `${tk.quan_an} quán`;
    document.getElementById("dem-quan-uong").textContent = `${tk.quan_uong} quán`;
    document.getElementById("thong-ke").textContent =
        `${tk.quan_an + tk.quan_uong} địa điểm · ${tk.tong_review} bài review`;
}

// ===================== Màn 2: Danh sách quán =====================

async function moDanhSach(loai) {
    loaiHienTai = loai;
    hienMan("man-danh-sach");
    dongFormQuan();

    document.getElementById("duong-dan-loai").textContent = TEN_LOAI[loai];
    document.getElementById("tieu-de-danh-sach").textContent =
        `${ICON_LOAI[loai]} ${TEN_LOAI[loai]}`;

    const khung = document.getElementById("danh-sach-quan");
    khung.innerHTML = `<p class="text-secondary">Đang tải...</p>`;

    const ds = await goiApi(`/api/quan?loai=${loai}`);
    if (!ds) { khung.innerHTML = ""; return; }

    if (ds.length === 0) {
        khung.innerHTML = `
            <div class="col-12">
                <div class="alert alert-light border text-center py-4">
                    Chưa có ${TEN_LOAI[loai].toLowerCase()} nào.
                    Bấm <strong>“+ Thêm quán mới”</strong> để thêm địa điểm đầu tiên.
                </div>
            </div>`;
        return;
    }

    khung.innerHTML = ds.map(theQuan).join("");
}

function theQuan(q) {
    const diem = q.so_review > 0
        ? `<span class="text-warning">${veSao(Math.round(q.diem_trung_binh))}</span>
           <span class="text-secondary small">${q.diem_trung_binh}/5 · ${q.so_review} review</span>`
        : `<span class="text-secondary small">Chưa có review</span>`;

    return `
        <div class="col-md-6 col-lg-4">
            <div class="card the-quan h-100 shadow-sm" role="button"
                 onclick="moChiTiet(${q.id})">
                ${khungAnh(q.anh || q.anh_mon, "160px", thoat(q.ten))}
                <div class="card-body">
                    <h5 class="card-title mb-1">${thoat(q.ten)}</h5>
                    <p class="text-secondary small mb-2">📍 ${thoat(q.dia_chi)}</p>
                    <div class="mb-2">${diem}</div>
                    <p class="card-text small text-truncate-2">
                        ${thoat(q.mo_ta) || "<em class='text-secondary'>Chưa có mô tả</em>"}
                    </p>
                </div>
                <div class="card-footer bg-white border-top-0 text-end">
                    <span class="small text-danger">Xem chi tiết →</span>
                </div>
            </div>
        </div>`;
}

// ---- Form thêm / sửa quán ----

function moFormThemQuan() {
    document.getElementById("tieu-de-form-quan").textContent = "Thêm quán mới";
    document.getElementById("form-quan").reset();
    document.getElementById("quan-dang-sua").value = "";
    document.getElementById("q-loai").value = loaiHienTai;
    boChonAnhMon();
    document.getElementById("khung-form-quan").hidden = false;
    document.getElementById("q-ten").focus();
}

async function moFormSuaQuan(id) {
    const q = await goiApi(`/api/quan/${id}`);
    if (!q) return;

    document.getElementById("tieu-de-form-quan").textContent = `Sửa: ${q.ten}`;
    document.getElementById("quan-dang-sua").value = q.id;
    document.getElementById("q-ten").value = q.ten;
    document.getElementById("q-loai").value = q.loai;
    document.getElementById("q-dia-chi").value = q.dia_chi;
    document.getElementById("q-mo-ta").value = q.mo_ta;
    boChonAnhMon();

    hienMan("man-danh-sach");
    document.getElementById("khung-form-quan").hidden = false;
    document.getElementById("q-ten").focus();
}

function dongFormQuan() {
    document.getElementById("khung-form-quan").hidden = true;
    document.getElementById("form-quan").reset();
    document.getElementById("quan-dang-sua").value = "";
    boChonAnhMon();
}

// ---- Ảnh minh hoạ món, chọn ngay trong form thêm quán ----

// Địa chỉ tạm của ảnh đang xem trước; phải thu hồi khi bỏ đi để không rò bộ nhớ
let duongDanXemTruoc = null;

/** Kiểm tra file người dùng chọn. Trả về "" nếu hợp lệ, hoặc câu báo lỗi. */
function loiCuaAnh(file) {
    if (!file.type.startsWith("image/"))
        return "Vui lòng chọn một file ảnh (JPG, PNG, WEBP...).";
    if (file.size > DUNG_LUONG_ANH_TOI_DA)
        return `Ảnh quá lớn (${(file.size / 1024 / 1024).toFixed(1)} MB). Tối đa 8 MB.`;
    return "";
}

/** Hiện ảnh xem trước ngay sau khi chọn file, chưa gửi gì lên máy chủ. */
function xemTruocAnhMon(input) {
    const file = input.files[0];
    if (!file) { boChonAnhMon(); return; }

    const loi = loiCuaAnh(file);
    if (loi) {
        hienThongBao(loi, "danger");
        boChonAnhMon();
        return;
    }

    if (duongDanXemTruoc) URL.revokeObjectURL(duongDanXemTruoc);
    duongDanXemTruoc = URL.createObjectURL(file);
    document.getElementById("anh-xem-truoc").src = duongDanXemTruoc;
    document.getElementById("khung-xem-truoc").hidden = false;
}

function boChonAnhMon() {
    if (duongDanXemTruoc) {
        URL.revokeObjectURL(duongDanXemTruoc);
        duongDanXemTruoc = null;
    }
    const o = document.getElementById("q-anh-mon");
    if (o) o.value = "";
    const khung = document.getElementById("khung-xem-truoc");
    if (khung) khung.hidden = true;
}

/** Thêm 1 món kèm ảnh cho quán vừa lưu. Trả về true nếu ảnh đã lên máy chủ.

    Làm 2 bước vì ảnh luôn thuộc về một bản ghi đã có: tạo món trước để
    lấy id, rồi mới gắn ảnh vào id đó.
 */
async function themMonKemAnh(quanId, tenMon, file) {
    const mon = await goiApi(`/api/quan/${quanId}/menu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ten_mon: tenMon || TEN_MON_MAC_DINH,
            gia: null,
            mo_ta: "",
        }),
    });
    if (!mon) return false;

    const form = new FormData();
    form.append("file", file);
    // KHÔNG tự đặt Content-Type: trình duyệt phải tự sinh chuỗi phân cách (boundary)
    const kq = await goiApi(`/api/menu/${mon.id}/anh`, { method: "POST", body: form });
    if (!kq) {
        // Món vẫn được giữ lại để người dùng thử tải ảnh lại ở màn chi tiết
        hienThongBao(`Đã lưu món "${mon.ten_mon}" nhưng chưa tải được ảnh.`, "warning");
        return false;
    }
    return true;
}

document.getElementById("form-quan").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("quan-dang-sua").value;
    const duLieu = {
        ten: document.getElementById("q-ten").value.trim(),
        loai: document.getElementById("q-loai").value,
        dia_chi: document.getElementById("q-dia-chi").value.trim(),
        mo_ta: document.getElementById("q-mo-ta").value.trim(),
    };

    // Lấy trước khi đóng form vì reset() sẽ xoá sạch các ô nhập
    const anhMon = document.getElementById("q-anh-mon").files[0] || null;
    const tenMon = document.getElementById("q-ten-mon").value.trim();

    const kq = await goiApi(id ? `/api/quan/${id}` : "/api/quan", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(duLieu),
    });
    if (!kq) return;

    // Quán phải tồn tại trước thì món và ảnh mới có chỗ để gắn vào
    let daCoAnh = false;
    if (anhMon) {
        hienThongBao("Đang tải ảnh món lên...", "secondary");
        daCoAnh = await themMonKemAnh(kq.id, tenMon, anhMon);
    }

    if (!anhMon || daCoAnh) {
        hienThongBao(
            id
                ? "Đã cập nhật quán."
                : daCoAnh
                    ? "Đã thêm quán mới kèm ảnh món."
                    : "Đã thêm quán mới."
        );
    }
    dongFormQuan();
    // Nếu đổi loại khi sửa, nhảy sang danh sách của loại mới
    await moDanhSach(duLieu.loai);
    await capNhatThongKe();
});

async function xoaQuan(id, ten) {
    if (!confirm(`Xoá quán "${ten}"?\n\nToàn bộ menu và bài review của quán này cũng sẽ bị xoá.`))
        return;

    const kq = await goiApi(`/api/quan/${id}`, { method: "DELETE" });
    if (!kq) return;

    hienThongBao("Đã xoá quán.");
    await moDanhSach(loaiHienTai);
    await capNhatThongKe();
}

// ===================== Màn 3: Chi tiết quán =====================

async function moChiTiet(id) {
    quanHienTai = id;
    hienMan("man-chi-tiet");

    const khung = document.getElementById("chi-tiet-noi-dung");
    khung.innerHTML = `<p class="text-secondary">Đang tải...</p>`;

    const q = await goiApi(`/api/quan/${id}`);
    if (!q) { khung.innerHTML = ""; return; }

    document.getElementById("duong-dan-ten-quan").textContent = q.ten;
    const veDs = document.getElementById("duong-dan-ve-danh-sach");
    veDs.textContent = TEN_LOAI[q.loai];
    veDs.onclick = (e) => { e.preventDefault(); moDanhSach(q.loai); };

    khung.innerHTML = htmlChiTiet(q);
    ganSuKienFormChiTiet(id);
}

function htmlChiTiet(q) {
    const diemTb = q.so_review > 0
        ? `<span class="text-warning fs-5">${veSao(Math.round(q.diem_trung_binh))}</span>
           <span class="text-secondary">${q.diem_trung_binh}/5 · ${q.so_review} bài review</span>`
        : `<span class="text-secondary">Chưa có bài review nào</span>`;

    return `
    <!-- Thông tin quán -->
    <div class="card shadow-sm mb-4">
        ${khungAnh(q.anh, "260px", thoat(q.ten))}
        <div class="card-body">
            <div class="mb-3 d-flex align-items-center gap-2 flex-wrap">
                <label class="btn btn-sm btn-outline-secondary mb-0">
                    ${q.anh ? "Đổi ảnh" : "+ Thêm ảnh quán"}
                    <input type="file" accept="image/*" class="d-none"
                           onchange="taiAnh('quan', ${q.id}, this)">
                </label>
                ${q.anh ? `<button class="btn btn-sm btn-outline-danger"
                                   onclick="goAnh('quan', ${q.id})">Xoá ảnh</button>` : ""}
                <span class="small text-secondary">Tối đa 8 MB, tự nén còn 1200px</span>
            </div>
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                <div>
                    <h2 class="mb-1">${ICON_LOAI[q.loai]} ${thoat(q.ten)}</h2>
                    <span class="badge bg-secondary">${TEN_LOAI[q.loai]}</span>
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-outline-secondary"
                            onclick="moFormSuaQuan(${q.id})">Sửa</button>
                    <button class="btn btn-sm btn-outline-danger"
                            onclick="xoaQuan(${q.id}, '${thoat(q.ten).replace(/'/g, "\\'")}')">Xoá</button>
                </div>
            </div>
            <hr>
            <p class="mb-2"><strong>📍 Địa chỉ:</strong> ${thoat(q.dia_chi)}</p>
            <p class="mb-2">${diemTb}</p>
            ${q.mo_ta ? `<p class="mb-0 text-secondary">${thoat(q.mo_ta)}</p>` : ""}
        </div>
    </div>

    <div class="row g-4">
        <!-- MENU -->
        <div class="col-lg-5">
            <div class="card shadow-sm h-100">
                <div class="card-header bg-white fw-semibold">📋 Menu</div>
                <ul class="list-group list-group-flush" id="khung-menu">
                    ${q.menu.length === 0
                        ? `<li class="list-group-item text-secondary">Chưa có món nào trong menu.</li>`
                        : q.menu.map(dongMenu).join("")}
                </ul>
                <div class="card-body border-top">
                    <form id="form-mon" class="row g-2">
                        <div class="col-7">
                            <input type="text" class="form-control form-control-sm"
                                   id="m-ten" placeholder="Tên món" required>
                        </div>
                        <div class="col-5">
                            <input type="number" class="form-control form-control-sm"
                                   id="m-gia" placeholder="Giá (VND)" min="0">
                        </div>
                        <div class="col-12">
                            <input type="text" class="form-control form-control-sm"
                                   id="m-mo-ta" placeholder="Ghi chú (không bắt buộc)">
                        </div>
                        <div class="col-12">
                            <button class="btn btn-sm btn-outline-danger w-100">+ Thêm món</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>

        <!-- REVIEW -->
        <div class="col-lg-7">
            <div class="card shadow-sm mb-3">
                <div class="card-header bg-white fw-semibold">✍️ Viết bài review</div>
                <div class="card-body">
                    <form id="form-review">
                        <div class="row g-2">
                            <div class="col-md-7">
                                <input type="text" class="form-control" id="r-nguoi"
                                       placeholder="Tên của bạn (để trống = Ẩn danh)">
                            </div>
                            <div class="col-md-5">
                                <select class="form-select" id="r-diem" required>
                                    <option value="5">⭐⭐⭐⭐⭐ Tuyệt vời</option>
                                    <option value="4">⭐⭐⭐⭐ Ngon</option>
                                    <option value="3" selected>⭐⭐⭐ Bình thường</option>
                                    <option value="2">⭐⭐ Tạm được</option>
                                    <option value="1">⭐ Không ngon</option>
                                </select>
                            </div>
                            <div class="col-12">
                                <textarea class="form-control" id="r-noi-dung" rows="3"
                                          placeholder="Cảm nhận của bạn về quán này..."></textarea>
                            </div>
                            <div class="col-12">
                                <button class="btn btn-danger w-100">Đăng bài review</button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            <h5 class="mb-3">Bài review (${q.reviews.length})</h5>
            <div id="khung-reviews">
                ${q.reviews.length === 0
                    ? `<p class="text-secondary">Chưa có bài review nào. Hãy là người đầu tiên!</p>`
                    : q.reviews.map(theReview).join("")}
            </div>
        </div>
    </div>`;
}

function dongMenu(m) {
    const anh = m.anh
        ? `<img src="/uploads/${encodeURIComponent(m.anh)}" alt="${thoat(m.ten_mon)}"
                class="anh-mon" loading="lazy">`
        : `<div class="anh-mon anh-trong d-flex align-items-center justify-content-center">🍽️</div>`;

    return `
        <li class="list-group-item d-flex justify-content-between align-items-start gap-2">
            ${anh}
            <div class="flex-grow-1">
                <div class="fw-semibold">${thoat(m.ten_mon)}</div>
                ${m.mo_ta ? `<div class="small text-secondary">${thoat(m.mo_ta)}</div>` : ""}
                <label class="small text-danger mb-0" role="button">
                    ${m.anh ? "Đổi ảnh" : "+ Ảnh"}
                    <input type="file" accept="image/*" class="d-none"
                           onchange="taiAnh('menu', ${m.id}, this)">
                </label>
                ${m.anh ? `<span class="small text-secondary ms-2" role="button"
                                 onclick="goAnh('menu', ${m.id})">Xoá ảnh</span>` : ""}
            </div>
            <div class="text-end">
                <div class="badge bg-light text-dark border">${dinhDangGia(m.gia)}</div>
                <button class="btn btn-sm btn-link text-danger p-0 ms-1"
                        onclick="xoaMon(${m.id})" title="Xoá món">&times;</button>
            </div>
        </li>`;
}

// ---- Tải / gỡ ảnh ----

/** loai: "quan" hoặc "menu". Gửi file bằng FormData. */
async function taiAnh(loai, id, input) {
    const file = input.files[0];
    if (!file) return;

    const form = new FormData();
    form.append("file", file);

    hienThongBao("Đang tải ảnh lên...", "secondary");
    // KHÔNG tự đặt Content-Type: trình duyệt phải tự sinh chuỗi phân cách (boundary)
    const kq = await goiApi(`/api/${loai}/${id}/anh`, { method: "POST", body: form });
    input.value = "";  // cho phép chọn lại đúng file đó lần sau
    if (!kq) return;

    hienThongBao("Đã tải ảnh lên.");
    moChiTiet(quanHienTai);
}

async function goAnh(loai, id) {
    if (!confirm("Xoá ảnh này?")) return;
    const kq = await goiApi(`/api/${loai}/${id}/anh`, { method: "DELETE" });
    if (!kq) return;
    hienThongBao("Đã xoá ảnh.");
    moChiTiet(quanHienTai);
}

function theReview(r) {
    return `
        <div class="card mb-2 shadow-sm">
            <div class="card-body py-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <strong>${thoat(r.nguoi_viet)}</strong>
                        <span class="text-warning ms-1">${veSao(r.diem)}</span>
                    </div>
                    <button class="btn btn-sm btn-link text-danger p-0"
                            onclick="xoaReview(${r.id})" title="Xoá review">&times;</button>
                </div>
                ${r.noi_dung
                    ? `<p class="mb-1 mt-2">${thoat(r.noi_dung)}</p>`
                    : `<p class="mb-1 mt-2 text-secondary"><em>Không có nội dung</em></p>`}
                <small class="text-muted">${r.ngay_tao}</small>
            </div>
        </div>`;
}

// Form trong màn chi tiết được tạo động nên phải gắn sự kiện lại sau mỗi lần render
function ganSuKienFormChiTiet(quanId) {
    document.getElementById("form-mon").addEventListener("submit", async (e) => {
        e.preventDefault();
        const giaRaw = document.getElementById("m-gia").value;
        const kq = await goiApi(`/api/quan/${quanId}/menu`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ten_mon: document.getElementById("m-ten").value.trim(),
                gia: giaRaw === "" ? null : parseInt(giaRaw, 10),
                mo_ta: document.getElementById("m-mo-ta").value.trim(),
            }),
        });
        if (!kq) return;
        hienThongBao("Đã thêm món vào menu.");
        moChiTiet(quanId);
    });

    document.getElementById("form-review").addEventListener("submit", async (e) => {
        e.preventDefault();
        const kq = await goiApi(`/api/quan/${quanId}/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nguoi_viet: document.getElementById("r-nguoi").value.trim() || "Ẩn danh",
                diem: parseInt(document.getElementById("r-diem").value, 10),
                noi_dung: document.getElementById("r-noi-dung").value.trim(),
            }),
        });
        if (!kq) return;
        hienThongBao("Đã đăng bài review.");
        moChiTiet(quanId);
        capNhatThongKe();
    });
}

async function xoaMon(id) {
    if (!confirm("Xoá món này khỏi menu?")) return;
    const kq = await goiApi(`/api/menu/${id}`, { method: "DELETE" });
    if (!kq) return;
    hienThongBao("Đã xoá món.");
    moChiTiet(quanHienTai);
}

async function xoaReview(id) {
    if (!confirm("Xoá bài review này?")) return;
    const kq = await goiApi(`/api/reviews/${id}`, { method: "DELETE" });
    if (!kq) return;
    hienThongBao("Đã xoá bài review.");
    moChiTiet(quanHienTai);
    capNhatThongKe();
}

// ===================== Khởi động =====================
document.addEventListener("DOMContentLoaded", moTrangChu);
