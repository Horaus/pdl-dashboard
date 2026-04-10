# Troubleshooting & Maintenance Notes (PDL Dashboard)

Tài liệu này tổng hợp các lỗi quan trọng đã được xử lý trên hệ thống PDL Dashboard (server 100.108.55.57) để tránh lặp lại trong tương lai.

---

## 🚀 1. Giải quyết Xung đột Cloudflare Tunnel & Traefik
- **Vấn đề**: Khi dự án chuyển từ Preview sang Production, hệ thống cũ xóa bỏ ánh xạ cổng (ví dụ: `8083`) để dùng Traefik. Điều này làm Cloudflare Tunnel (trỏ về 8083) bị lỗi.
- **Giải pháp**: `manager.sh` v4.5 mới đã hỗ trợ **song song** cả Traefik (dùng Host header) và Port Mapping (cho Tunnel).
- **Lưu ý**: Khi nâng cấp lên production, Dashboard hiện tại đã được cấu hình để gửi kèm cổng (port) cũ, giúp tunnel luôn giữ được kết nối.

## 🔒 2. Lưu ý về SSL (Let's Encrypt)
- **Cảnh báo**: Nếu tên miền đang trỏ về Cloudflare Tunnel (dùng CNAME), Traefik sẽ **không thể** tự cấp SSL vì DNS không trỏ trực tiếp về server (lỗi NXDOMAIN).
- **Cách làm đúng**: Hãy để Cloudflare xử lý SSL trên Edge. Traefik chỉ cần đóng vai trò định tuyến nội bộ qua HTTP (port 80).

## 📂 3. Cấu hình Dockerfile Linh hoạt
- **Kinh nghiệm**: Các dự án GitHub có cấu trúc khác nhau (có hoặc không có thư mục `source/`). 
- **Giải pháp**: `manager.sh` hiện tại tự kiểm tra folder `source`. Tuy nhiên, trong `Dockerfile`, hãy ưu tiên dùng `COPY . .` thay vì `COPY source/ .` nếu bạn muốn hỗ trợ mọi cấu trúc folder.

## 🖥 4. Quản lý Trạng thái Dự án (React State)
- **Lưu ý**: Các thông tin như `productionUrl`, `previewUrl` và `status` cần được cập nhật vào `localStorage` ngay sau khi deploy thành công để tránh bị mất khi refresh trang.
- **File quan trọng**: `src/App.jsx` điều phối việc lưu trữ này.

## 🛠 5. Quyền hạn & Restart Backend
- **Lưu ý**: Backend dashboard (`server/index.js`) đang chạy dưới quyền `root`. Nếu bạn sửa code backend, phải dùng `sudo` để restart.
- **Lệnh restart nhanh**:
  ```bash
  sudo pkill -f "node index.js" && cd /home/pdl1host/webs/pdl-dashboard/server && sudo nohup node index.js > output.log 2>&1 &
  ```

## ⚡ 6. Tối ưu UI (Mượt mà & Copy nhanh)
- **Cải tiến**: Đã thêm tính năng **Click-to-copy** cho các giá trị DNS.
- **Lưu ý**: Không dùng animation lồng nhau quá nhiều trong các modal có input gõ liên tục để tránh hiện tượng "giật/lag" giao diện.
