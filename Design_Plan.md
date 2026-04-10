# Kế hoạch Thiết kế Giao diện (Design Plan)

Dựa trên phân tích trang [studio.pdl.io.vn](https://studio.pdl.io.vn/), bản kế hoạch này đề xuất một giao diện mới hiện đại, tối giản và mang đậm phong cách công nghệ (High-tech Minimalist).

## 🎨 1. Bảng màu & Phong cách (Visual Palette)
Thiết kế tập trung vào sự tương phản cực cao (High Contrast) để tạo ấn tượng mạnh.

- **Primary Background**: `#0A0A0A` (Đen sâu) - Tạo chiều sâu và cảm giác sang trọng.
- **Pure White**: `#FFFFFF` - Dùng cho tiêu đề chính để tăng độ đọc.
- **Accent Blue**: `#007BFF` - Màu xanh nhấn (High-tech Blue) dùng cho các chi tiết nhỏ, dấu chấm logo và nút bấm.
- **Secondary Grey**: `#9CA3AF` - Dùng cho văn bản phụ và mô tả.

## ✍️ 2. Hệ thống Typography
Sử dụng các font chữ Sans-serif hiện đại với khoảng cách ký tự (tracking) thoáng.

- **Headline Focus**: Font **Space Grotesk** hoặc **Inter**. 
- **Style**: In hoa (ALL CAPS) cho các tiêu đề lớn, trọng lượng Bold (700+).
- **Details**: Cỡ chữ nhỏ hơn, khoảng cách dòng (line-height) 1.6 để tạo sự dễ chịu khi đọc.

## 📐 3. Cấu trúc Bố cục (Layout Sections)

### Hero Section (Split Screen)
- Sử dụng bố cục chia đôi màn hình (Vertical Split).
- Mỗi bên đại diện cho một mảng kinh doanh/dịch vụ (ví dụ: Marketing vs R&D).
- Hiệu ứng: Cột sẽ mở rộng mượt mà khi di chuột vào (Hover Expansion).

### Navigation & Header
- Thanh menu tối giản, trong suốt (Transparent Sticky Header).
- Logo "PDL STUDIO." với dấu chấm xanh đặc trưng.

### Systems/Services Section
- Cấu trúc "Accordion" đứng: Các nội dung được trình bày thành các cột dọc, click hoặc hover để xem chi tiết hình ảnh và mô tả sản phẩm.

## 🖼 4. Minh họa Giao diện Mới (Mockups)

````carousel
![Giao diện Homepage hiện tại](file:///Users/horaus/.gemini/antigravity/brain/16ba7119-0e52-4d3a-9135-cbbd49857b16/homepage_analysis_1773976594393.png)
<!-- slide -->
![Chi tiết trang Systems](file:///Users/horaus/.gemini/antigravity/brain/16ba7119-0e52-4d3a-9135-cbbd49857b16/systems_page_analysis_1773976757841.png)
<!-- slide -->
![Mockup Đề xuất cho Giao diện Mới](file:///Users/horaus/.gemini/antigravity/brain/16ba7119-0e52-4d3a-9135-cbbd49857b16/new_pdl_studio_mockup_1773976811742.png)
````

## 🚀 5. Các bước triển khai tiếp theo
1. **Thiết kế chi tiết**: Tạo các component React dựa trên bảng màu và font chữ đã chọn.
2. **Hiệu ứng chuyển động**: Sử dụng Framer Motion để tạo các hiệu ứng mở rộng cột (Accordion) và fade-in mượt mà.
3. **Tối ưu hóa hình ảnh**: Sử dụng định dạng WebP và hiệu ứng Blur-up để đảm bảo tốc độ tải trang cực nhanh.
