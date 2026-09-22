// ===================== Trạng thái =====================
const TEN_LOAI = { an: "Quán ăn", uong: "Quán đồ uống" };
const ICON_LOAI = { an: "🍜", uong: "🧋" };

let loaiHienTai = null;   // null = tất cả, hoặc "an" / "uong"
let quanHienTai = null;   // id quán đang xem ở màn chi tiết
let monDangSua = null;    // id món đang mở form sửa trong menu
let reviewDangSua = null; // id bài review đang mở form sửa

// Danh sách quán đang giữ trong bộ nhớ. Ô tìm kiếm và các tab sắp xếp lọc
// ngay trên mảng này, không gọi lại máy chủ sau mỗi phím gõ.
let danhSachGoc = [];
let tuKhoa = "";
let sapXep = "moi";

// Phải khớp với DUNG_LUONG_TOI_DA trong anh.py: chặn sớm ở trình duyệt để
// người dùng biết ngay, không phải chờ tải hết 20 MB lên rồi mới nhận lỗi.
const DUNG_LUONG_ANH_TOI_DA = 8 * 1024 * 1024;
const TEN_MON_MAC_DINH = "Món đặc trưng";

// ===================== Tiện ích =====================

// Chặn HTML injection từ dữ liệu người dùng nhập.
//
// Phải escape CẢ HAI loại dấu nháy, không chỉ < > &. Cách cũ (gán textContent
// rồi đọc innerHTML) để lọt dấu " nguyên vẹn, nên một cái tên như
//     Quán X" onmouseover="mã_độc()
// thoát ra khỏi thuộc tính HTML và chạy được JavaScript.
function thoat(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function dinhDangGia(gia) {
    return gia === null || gia === undefined
        ? "Chưa rõ giá"
        : `${gia.toLocaleString("vi-VN")} đ`;
}

function veSao(diem) {
    return "★".repeat(diem) + "☆".repeat(5 - diem);
}

/** Chữ cái đầu của tên người viết, dùng làm avatar tròn trên thẻ quán. */
function chuDau(ten) {
    const t = (ten || "?").trim();
    return t ? t[0] : "?";
}

function hienThongBao(noiDung, loai = "success") {
    const el = document.getElementById("thong-bao");
    el.className = `toast align-items-center text-white border-0 bg-${loai}`;
    document.getElementById("thong-bao-noi-dung").textContent = noiDung;
    bootstrap.Toast.getOrCreateInstance(el, { delay: 3000 }).show();
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

/** Hiện đúng 1 màn hình, ẩn màn còn lại. */
function hienMan(id) {
    ["man-danh-sach", "man-chi-tiet"].forEach(m => {
        document.getElementById(m).hidden = (m !== id);
    });
    window.scrollTo(0, 0);
}

// ===================== Màn danh sách =====================

async function capNhatThongKe() {
    const tk = await goiApi("/api/thong-ke");
    if (!tk) return;
    document.getElementById("dem-quan-an").textContent = tk.quan_an;
    document.getElementById("dem-quan-uong").textContent = tk.quan_uong;
    document.getElementById("dem-review").textContent = tk.tong_review;
    document.getElementById("thong-ke").textContent =
        `${tk.quan_an + tk.quan_uong} địa điểm · ${tk.tong_review} bài review`;
}

/** Tô đậm mục đang chọn ở sidebar, dải đen trên cùng và ô lọc danh mục. */
function danhDauDangChon(loai) {
    document.querySelectorAll("#menu-sidebar .muc-sidebar").forEach(a => {
        a.classList.toggle("dang-chon", (a.dataset.loai || "") === (loai || ""));
    });
    const nhan = { "": "Khám Phá", an: "Quán Ăn", uong: "Quán Đồ Uống" }[loai || ""];
    document.querySelectorAll(".tab-den").forEach(a => {
        a.classList.toggle("dang-chon", a.textContent.trim() === nhan);
    });
    document.getElementById("loc-loai").value = loai || "";
}

async function moDanhSach(loai) {
    loaiHienTai = loai || null;
    hienMan("man-danh-sach");
    dongFormQuan();
    danhDauDangChon(loaiHienTai);

    const khung = document.getElementById("danh-sach-quan");
    khung.innerHTML = `<div class="khong-co-gi">Đang tải...</div>`;

    const ds = await goiApi(loaiHienTai ? `/api/quan?loai=${loaiHienTai}` : "/api/quan");
    if (!ds) { khung.innerHTML = ""; return; }

    danhSachGoc = ds;
    veLuoiQuan();
    await capNhatThongKe();
}

/** Áp từ khoá tìm kiếm và kiểu sắp xếp lên danh sách đang giữ, rồi vẽ lại lưới. */
function veLuoiQuan() {
    const khung = document.getElementById("danh-sach-quan");

    const tu = tuKhoa.trim().toLowerCase();
    let ds = danhSachGoc.filter(q =>
        !tu ||
        q.ten.toLowerCase().includes(tu) ||
        q.dia_chi.toLowerCase().includes(tu) ||
        (q.mo_ta || "").toLowerCase().includes(tu)
    );

    if (sapXep === "diem") {
        ds = [...ds].sort((a, b) => b.diem_trung_binh - a.diem_trung_binh);
    } else if (sapXep === "review") {
        ds = [...ds].sort((a, b) => b.so_review - a.so_review);
    }

    if (ds.length === 0) {
        khung.innerHTML = `<div class="khong-co-gi">${
            tu
                ? `Không tìm thấy địa điểm nào khớp với “${thoat(tuKhoa)}”.`
                : "Chưa có địa điểm nào. Bấm <strong>+ Thêm quán</strong> ở trên để bắt đầu."
        }</div>`;
        return;
    }

    khung.innerHTML = ds.map(theQuan).join("");
}

function locTheoTuKhoa(gia_tri) {
    tuKhoa = gia_tri;
    if (document.getElementById("man-danh-sach").hidden) {
        hienMan("man-danh-sach");
    }
    veLuoiQuan();
}

/** Một thẻ quán trong lưới: ảnh, tên, địa chỉ, trích review, chân thẻ. */
function theQuan(q) {
    const anh = q.anh || q.anh_mon;
    const khungAnh = anh
        ? `<img src="/uploads/${encodeURIComponent(anh)}" class="anh-the"
                alt="${thoat(q.ten)}" loading="lazy">`
        : `<div class="anh-trong">${ICON_LOAI[q.loai]}</div>`;

    const trich = q.review_nguoi_viet
        ? `<div class="trich-review">
               <div class="anh-dai-dien">${thoat(chuDau(q.review_nguoi_viet))}</div>
               <div class="noi-dung-trich">
                   <span class="ten-nguoi-viet">${thoat(q.review_nguoi_viet)}</span>${
                       q.review_noi_dung
                           ? thoat(q.review_noi_dung)
                           : "<em>đã chấm điểm quán này</em>"
                   }
               </div>
           </div>`
        : `<div class="chua-review">Chưa có bài review nào</div>`;

    const diem = q.so_review > 0
        ? `<span class="diem-the">${q.diem_trung_binh}</span>`
        : `<span class="diem-the trong">—</span>`;

    return `
        <article class="the-quan" onclick="moChiTiet(${q.id})">
            ${khungAnh}
            <div class="than-the">
                <div class="ten-quan">${thoat(q.ten)}</div>
                <div class="dia-chi-the">${thoat(q.dia_chi)}</div>
                ${trich}
            </div>
            <div class="chan-the">
                <span>💬 ${q.so_review}</span>
                <span>📷 ${q.so_anh}</span>
                ${diem}
            </div>
        </article>`;
}

// ---- Form thêm / sửa quán ----

function moFormThemQuan() {
    hienMan("man-danh-sach");
    document.getElementById("tieu-de-form-quan").textContent = "Thêm quán mới";
    document.getElementById("form-quan").reset();
    document.getElementById("quan-dang-sua").value = "";
    document.getElementById("q-loai").value = loaiHienTai || "an";
    boChonAnhMon();
    document.getElementById("khung-anh-quan-moi").hidden = false;
    document.getElementById("khung-mon-dau-tien").hidden = false;
    document.getElementById("khung-form-quan").hidden = false;
    document.getElementById("q-ten").focus();
}

async function moFormSuaQuan(id) {
    const q = await goiApi(`/api/quan/${id}`);
    if (!q) return;

    document.getElementById("form-quan").reset();
    document.getElementById("tieu-de-form-quan").textContent = `Sửa: ${q.ten}`;
    document.getElementById("quan-dang-sua").value = q.id;
    // Khối ảnh và món chỉ dành cho quán mới; khi sửa thì quản lý ở màn chi tiết
    document.getElementById("khung-anh-quan-moi").hidden = true;
    document.getElementById("khung-mon-dau-tien").hidden = true;
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

/** Thêm 1 món (kèm ảnh nếu có) cho quán vừa lưu.

    Làm 2 bước vì ảnh luôn thuộc về một bản ghi đã có: tạo món trước để
    lấy id, rồi mới gắn ảnh vào id đó.
 */
async function themMonKemAnh(quanId, tenMon, gia, file) {
    const mon = await goiApi(`/api/quan/${quanId}/menu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ten_mon: tenMon || TEN_MON_MAC_DINH,
            gia: gia,
            mo_ta: "",
        }),
    });
    if (!mon) return false;

    // Món không kèm ảnh thì đã xong ngay ở bước trên
    if (!file) return true;

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
    const anhQuan = Array.from(document.getElementById("q-anh-quan").files || []);
    const anhMon = document.getElementById("q-anh-mon").files[0] || null;
    const tenMon = document.getElementById("q-ten-mon").value.trim();
    const giaMonRaw = document.getElementById("q-gia-mon").value;
    const giaMon = giaMonRaw === "" ? null : parseInt(giaMonRaw, 10);
    // Chỉ tạo món khi người dùng có nhập ít nhất một trong ba ô
    const coMon = Boolean(tenMon || giaMon !== null || anhMon);

    const kq = await goiApi(id ? `/api/quan/${id}` : "/api/quan", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(duLieu),
    });
    if (!kq) return;

    if (anhQuan.length > 0 && !id) {
        const form = new FormData();
        anhQuan.forEach(f => form.append("files", f));
        hienThongBao(`Đang tải ${anhQuan.length} ảnh quán lên...`, "secondary");
        await goiApi(`/api/quan/${kq.id}/thu-vien`, { method: "POST", body: form });
    }

    // Quán phải tồn tại trước thì món và ảnh mới có chỗ để gắn vào.
    // Khi sửa quán (id đã có) thì không tạo thêm món, tránh nhân bản mỗi lần lưu.
    let daLuuMon = false;
    if (coMon && !id) {
        if (anhMon) hienThongBao("Đang tải ảnh món lên...", "secondary");
        daLuuMon = await themMonKemAnh(kq.id, tenMon, giaMon, anhMon);
    }

    if (!coMon || daLuuMon) {
        hienThongBao(
            id
                ? "Đã cập nhật quán."
                : daLuuMon
                    ? "Đã thêm quán mới kèm món."
                    : "Đã thêm quán mới."
        );
    }
    dongFormQuan();
    // Nếu đổi loại khi sửa, nhảy sang danh sách của loại mới
    await moDanhSach(duLieu.loai);
});

async function xoaQuan(id, ten) {
    if (!confirm(`Xoá quán "${ten}"?\n\nToàn bộ menu, ảnh và bài review của quán này cũng sẽ bị xoá.`))
        return;

    const kq = await goiApi(`/api/quan/${id}`, { method: "DELETE" });
    if (!kq) return;

    hienThongBao("Đã xoá quán.");
    await moDanhSach(loaiHienTai);
}

// ===================== Màn chi tiết quán =====================

async function moChiTiet(id) {
    quanHienTai = id;
    hienMan("man-chi-tiet");

    const khung = document.getElementById("chi-tiet-noi-dung");
    khung.innerHTML = `<div class="khong-co-gi">Đang tải...</div>`;

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
    const diem = q.so_review > 0
        ? `<span class="diem-lon">${q.diem_trung_binh}</span>
           <span class="sao-vang">${veSao(Math.round(q.diem_trung_binh))}</span>
           <span class="ghi-chu">${q.so_review} bài review</span>`
        : `<span class="ghi-chu">Chưa có bài review nào</span>`;

    const bia = q.anh
        ? `<img src="/uploads/${encodeURIComponent(q.anh)}" class="anh-bia-lon"
                alt="${thoat(q.ten)}">`
        : `<div class="anh-bia-trong">${ICON_LOAI[q.loai]}</div>`;

    return `
    <div class="hop-trang">
        ${bia}
        <div class="than-hop">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                <div>
                    <h1 class="ten-quan-lon">${thoat(q.ten)}</h1>
                    <span class="nhan-loai">${ICON_LOAI[q.loai]} ${TEN_LOAI[q.loai]}</span>
                </div>
                <div class="d-flex gap-2">
                    <label class="nut-vien mb-0" style="cursor:pointer">
                        📷 Đăng ảnh quán
                        <input type="file" accept="image/*" multiple class="d-none"
                               onchange="taiAnhQuan(${q.id}, this)">
                    </label>
                    ${q.anh ? `<button class="nut-vien" onclick="boAnhBia(${q.id})">Bỏ ảnh bìa</button>` : ""}
                    <button class="nut-vien" onclick="moFormSuaQuan(${q.id})">Sửa</button>
                    <button class="nut-vien" data-xoa-quan="${q.id}" data-ten="${thoat(q.ten)}">Xoá</button>
                </div>
            </div>
            <hr>
            <p class="mb-2">📍 <strong>Địa chỉ:</strong> ${thoat(q.dia_chi)}</p>
            <p class="mb-2">${diem}</p>
            ${q.mo_ta ? `<p class="mb-0 ghi-chu">${thoat(q.mo_ta)}</p>` : ""}
        </div>
    </div>

    ${khoiThuVien(q)}

    <div class="cot-doi">
        <!-- MENU -->
        <div class="hop-trang">
            <div class="dau-hop">📋 Menu</div>
            <div id="khung-menu">
                ${q.menu.length === 0
                    ? `<div class="than-hop ghi-chu">Chưa có món nào trong menu.</div>`
                    : q.menu.map(dongMenu).join("")}
            </div>
            <div class="than-hop" style="border-top:1px solid var(--vien)">
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
                        <button class="nut-vien w-100">+ Thêm món</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- REVIEW -->
        <div>
            <div class="hop-trang">
                <div class="dau-hop">✍️ Viết bài review</div>
                <div class="than-hop">
                    <form id="form-review">
                        <div class="row g-2">
                            <div class="col-md-7">
                                <input type="text" class="form-control" id="r-nguoi"
                                       placeholder="Tên của bạn (để trống = Ẩn danh)">
                            </div>
                            <div class="col-md-5">
                                <select class="form-select" id="r-diem" required>
                                    <option value="5">★★★★★ Tuyệt vời</option>
                                    <option value="4">★★★★ Ngon</option>
                                    <option value="3" selected>★★★ Bình thường</option>
                                    <option value="2">★★ Tạm được</option>
                                    <option value="1">★ Không ngon</option>
                                </select>
                            </div>
                            <div class="col-12">
                                <textarea class="form-control" id="r-noi-dung" rows="3"
                                          placeholder="Cảm nhận của bạn về quán này..."></textarea>
                            </div>
                            <div class="col-12">
                                <button class="nut-do w-100">Đăng bài review</button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            <div class="dau-hop" style="background:#fff;border:1px solid var(--vien);margin-bottom:10px">
                Bài review (${q.reviews.length})
            </div>
            <div id="khung-reviews">
                ${q.reviews.length === 0
                    ? `<div class="khong-co-gi">Chưa có bài review nào. Hãy là người đầu tiên!</div>`
                    : q.reviews.map(theReview).join("")}
            </div>
        </div>
    </div>`;
}

/** Lưới ảnh không gian quán. */
function khoiThuVien(q) {
    const anhList = q.thu_vien || [];
    if (anhList.length === 0) {
        return `
    <div class="hop-trang">
        <div class="than-hop ghi-chu text-center">
            📷 Quán này chưa có ảnh nào.
            Bấm <strong>Đăng ảnh quán</strong> ở trên để người đọc thấy quán trông thế nào.
        </div>
    </div>`;
    }

    const o = anhList.map(a => {
        const laBia = a.ten_file === q.anh;
        return `
        <div class="o-thu-vien ${laBia ? "la-bia" : ""}">
            <img src="/uploads/${encodeURIComponent(a.ten_file)}"
                 class="anh-thu-vien" loading="lazy"
                 alt="Ảnh quán ${thoat(q.ten)}"
                 onclick="xemAnhLon('${encodeURIComponent(a.ten_file)}')">
            <div class="chan-thu-vien">
                ${laBia
                    ? `<span class="nhan-bia">Ảnh bìa</span>`
                    : `<button class="lien-ket-nho" onclick="datAnhBia(${q.id}, ${a.id})">Đặt làm bìa</button>`}
                <button class="lien-ket-nho do ms-2" onclick="xoaAnhThuVien(${a.id})">Xoá</button>
            </div>
        </div>`;
    }).join("");

    return `
    <div class="hop-trang">
        <div class="dau-hop">📷 Ảnh quán (${anhList.length})</div>
        <div class="than-hop">
            <div class="luoi-thu-vien">${o}</div>
        </div>
    </div>`;
}

/** Mở ảnh ở kích thước đầy đủ trong tab mới. */
function xemAnhLon(tenFileDaMaHoa) {
    window.open(`/uploads/${tenFileDaMaHoa}`, "_blank", "noopener");
}

/** Tải một hoặc nhiều ảnh quán lên thư viện. */
async function taiAnhQuan(quanId, input) {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;

    for (const f of files) {
        const loi = loiCuaAnh(f);
        if (loi) {
            hienThongBao(`${f.name}: ${loi}`, "danger");
            input.value = "";
            return;
        }
    }

    const form = new FormData();
    // Tên trường phải là "files" để khớp tham số List[UploadFile] ở máy chủ
    files.forEach(f => form.append("files", f));

    hienThongBao(`Đang tải ${files.length} ảnh lên...`, "secondary");
    const kq = await goiApi(`/api/quan/${quanId}/thu-vien`, {
        method: "POST",
        body: form,
    });
    input.value = "";  // cho phép chọn lại đúng file đó lần sau
    if (!kq) return;

    hienThongBao(`Đã đăng ${files.length} ảnh.`);
    moChiTiet(quanId);
}

async function datAnhBia(quanId, anhId) {
    const kq = await goiApi(`/api/quan/${quanId}/anh-bia/${anhId}`, { method: "PUT" });
    if (!kq) return;
    hienThongBao("Đã đặt làm ảnh bìa.");
    moChiTiet(quanId);
}

async function boAnhBia(quanId) {
    const kq = await goiApi(`/api/quan/${quanId}/anh`, { method: "DELETE" });
    if (!kq) return;
    hienThongBao("Đã bỏ ảnh bìa. Ảnh vẫn còn trong thư viện.");
    moChiTiet(quanId);
}

async function xoaAnhThuVien(anhId) {
    if (!confirm("Xoá hẳn ảnh này khỏi thư viện?")) return;
    const kq = await goiApi(`/api/thu-vien/${anhId}`, { method: "DELETE" });
    if (!kq) return;
    hienThongBao("Đã xoá ảnh.");
    moChiTiet(quanHienTai);
}

// ---- Menu ----

function dongMenu(m) {
    if (monDangSua === m.id) return dongMenuDangSua(m);

    const anh = m.anh
        ? `<img src="/uploads/${encodeURIComponent(m.anh)}" alt="${thoat(m.ten_mon)}"
                class="anh-mon" loading="lazy">`
        : `<div class="anh-mon anh-trong d-flex align-items-center justify-content-center">🍽️</div>`;

    return `
        <div class="dong-mon">
            ${anh}
            <div class="flex-grow-1 min-width-0">
                <div class="fw-bold">${thoat(m.ten_mon)}</div>
                ${m.mo_ta ? `<div class="ghi-chu">${thoat(m.mo_ta)}</div>` : ""}
                <label class="lien-ket-nho do" style="cursor:pointer">
                    ${m.anh ? "Đổi ảnh" : "+ Ảnh"}
                    <input type="file" accept="image/*" class="d-none"
                           onchange="taiAnh('menu', ${m.id}, this)">
                </label>
                ${m.anh ? `<button class="lien-ket-nho ms-2" onclick="goAnh('menu', ${m.id})">Xoá ảnh</button>` : ""}
            </div>
            <div class="text-end">
                <div class="gia-mon">${dinhDangGia(m.gia)}</div>
                <div class="mt-1">
                    <button class="lien-ket-nho" onclick="moSuaMon(${m.id})">Sửa</button>
                    <button class="lien-ket-nho do ms-2" onclick="xoaMon(${m.id})">Xoá</button>
                </div>
            </div>
        </div>`;
}

/** Dòng menu ở chế độ sửa: đổi tên, giá và ghi chú của món đã lưu. */
function dongMenuDangSua(m) {
    return `
        <div class="dong-mon" style="background:#fafafa">
            <form class="row g-2 w-100" data-sua-mon="${m.id}">
                <div class="col-7">
                    <input type="text" class="form-control form-control-sm"
                           name="ten_mon" value="${thoat(m.ten_mon)}" required>
                </div>
                <div class="col-5">
                    <input type="number" class="form-control form-control-sm" min="0"
                           name="gia" placeholder="Giá (VND)"
                           value="${m.gia === null || m.gia === undefined ? "" : m.gia}">
                </div>
                <div class="col-12">
                    <input type="text" class="form-control form-control-sm"
                           name="mo_ta" placeholder="Ghi chú" value="${thoat(m.mo_ta)}">
                </div>
                <div class="col-12 d-flex gap-2">
                    <button class="nut-do flex-grow-1">Lưu</button>
                    <button type="button" class="nut-vien" onclick="huySuaMon()">Huỷ</button>
                </div>
            </form>
        </div>`;
}

function moSuaMon(id) {
    monDangSua = id;
    moChiTiet(quanHienTai);
}

function huySuaMon() {
    monDangSua = null;
    moChiTiet(quanHienTai);
}

// ---- Tải / gỡ ảnh món ----

/** loai: "menu". Gửi file bằng FormData. */
async function taiAnh(loai, id, input) {
    const file = input.files[0];
    if (!file) return;

    const loi = loiCuaAnh(file);
    if (loi) { hienThongBao(loi, "danger"); input.value = ""; return; }

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

// ---- Bài review ----

function theReview(r) {
    if (reviewDangSua === r.id) return theReviewDangSua(r);

    // Chỉ hiện mốc sửa khi bài review thực sự đã từng được sửa
    const dauSua = r.ngay_cap_nhat
        ? ` · <em>đã sửa ${thoat(r.ngay_cap_nhat)}</em>`
        : "";

    return `
        <div class="the-review">
            <div class="d-flex justify-content-between align-items-start">
                <div class="d-flex gap-2 align-items-center">
                    <div class="anh-dai-dien">${thoat(chuDau(r.nguoi_viet))}</div>
                    <div>
                        <strong>${thoat(r.nguoi_viet)}</strong>
                        <span class="sao-vang ms-1">${veSao(r.diem)}</span>
                    </div>
                </div>
                <div class="text-nowrap">
                    <button class="lien-ket-nho" onclick="moSuaReview(${r.id})">Sửa</button>
                    <button class="lien-ket-nho do ms-2" onclick="xoaReview(${r.id})">Xoá</button>
                </div>
            </div>
            ${r.noi_dung
                ? `<p class="mb-1 mt-2">${thoat(r.noi_dung)}</p>`
                : `<p class="mb-1 mt-2 ghi-chu"><em>Không có nội dung</em></p>`}
            <div class="moc-thoi-gian">${thoat(r.ngay_tao)}${dauSua}</div>
        </div>`;
}

/** Bài review ở chế độ sửa. Lưu xong máy chủ sẽ ghi lại ngày giờ cập nhật. */
function theReviewDangSua(r) {
    const chonDiem = [5, 4, 3, 2, 1]
        .map(d => `<option value="${d}" ${d === r.diem ? "selected" : ""}>${veSao(d)}</option>`)
        .join("");

    return `
        <div class="the-review dang-sua">
            <form class="row g-2" data-sua-review="${r.id}">
                <div class="col-md-7">
                    <input type="text" class="form-control" name="nguoi_viet"
                           value="${thoat(r.nguoi_viet)}"
                           placeholder="Tên của bạn (để trống = Ẩn danh)">
                </div>
                <div class="col-md-5">
                    <select class="form-select" name="diem" required>${chonDiem}</select>
                </div>
                <div class="col-12">
                    <textarea class="form-control" name="noi_dung" rows="3"
                              placeholder="Cảm nhận của bạn về quán này...">${thoat(r.noi_dung)}</textarea>
                </div>
                <div class="col-12 d-flex gap-2">
                    <button class="nut-do flex-grow-1">Lưu thay đổi</button>
                    <button type="button" class="nut-vien" onclick="huySuaReview()">Huỷ</button>
                </div>
            </form>
        </div>`;
}

function moSuaReview(id) {
    reviewDangSua = id;
    moChiTiet(quanHienTai);
}

function huySuaReview() {
    reviewDangSua = null;
    moChiTiet(quanHienTai);
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

    // Nút Xoá quán: tên quán đi qua dataset nên không bao giờ được diễn giải
    // như mã JavaScript, khác với cách nhúng thẳng vào onclick trước đây
    const nutXoaQuan = document.querySelector("[data-xoa-quan]");
    if (nutXoaQuan) {
        nutXoaQuan.addEventListener("click", () =>
            xoaQuan(Number(nutXoaQuan.dataset.xoaQuan), nutXoaQuan.dataset.ten)
        );
    }

    // Form sửa món: chỉ có mặt khi đang mở chế độ sửa một món
    const formSuaMon = document.querySelector("[data-sua-mon]");
    if (formSuaMon) {
        formSuaMon.addEventListener("submit", async (e) => {
            e.preventDefault();
            const f = new FormData(formSuaMon);
            const giaRaw = f.get("gia");
            const kq = await goiApi(`/api/menu/${formSuaMon.dataset.suaMon}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ten_mon: f.get("ten_mon").trim(),
                    gia: giaRaw === "" ? null : parseInt(giaRaw, 10),
                    mo_ta: f.get("mo_ta").trim(),
                }),
            });
            if (!kq) return;
            monDangSua = null;
            hienThongBao("Đã cập nhật món.");
            moChiTiet(quanId);
        });
    }

    // Form sửa review: chỉ có mặt khi đang mở chế độ sửa một bài review
    const formSuaReview = document.querySelector("[data-sua-review]");
    if (formSuaReview) {
        formSuaReview.addEventListener("submit", async (e) => {
            e.preventDefault();
            const f = new FormData(formSuaReview);
            const kq = await goiApi(`/api/reviews/${formSuaReview.dataset.suaReview}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nguoi_viet: f.get("nguoi_viet").trim() || "Ẩn danh",
                    diem: parseInt(f.get("diem"), 10),
                    noi_dung: f.get("noi_dung").trim(),
                }),
            });
            if (!kq) return;
            reviewDangSua = null;
            hienThongBao(`Đã cập nhật bài review lúc ${kq.ngay_cap_nhat}.`);
            moChiTiet(quanId);
            capNhatThongKe();
        });
    }
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

// Tab sắp xếp: lọc ngay trên dữ liệu đang có, không gọi lại máy chủ
document.getElementById("nhom-tab").addEventListener("click", (e) => {
    const nut = e.target.closest(".tab");
    if (!nut) return;
    document.querySelectorAll("#nhom-tab .tab")
        .forEach(t => t.classList.toggle("dang-chon", t === nut));
    sapXep = nut.dataset.sapXep;
    veLuoiQuan();
});

document.addEventListener("DOMContentLoaded", () => moDanhSach(null));
