# PDL Dashboard

PDL Dashboard gồm:
- Frontend: React + Vite (`/`)
- Backend API quản lý deploy: Express (`/server`)

Mục tiêu repo: clone từ GitHub và chạy lại nhanh, không phụ thuộc file build tạm.

## 1) Yêu cầu

- Node.js 20+
- npm 10+
- Docker + Docker Compose (nếu chạy bằng container)

## 2) Cấu trúc chính

```text
pdl-dashboard/
├─ src/                  # frontend source
├─ server/               # backend source
├─ Dockerfile            # frontend image
├─ docker-compose.yml    # chạy cả frontend + backend
├─ nginx.conf
├─ .env.example
└─ README.md
```

## 3) Chạy local (không Docker)

```bash
# frontend deps
npm install

# backend deps
npm --prefix server install

# chạy đồng thời frontend + backend
npm run dev:full
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## 4) Chạy bằng Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

Mặc định:
- Dashboard: `http://localhost:8090`
- Backend: `http://localhost:3001`

Bạn có thể đổi port/path trong `.env`:
- `DASHBOARD_PORT`
- `BACKEND_PORT`
- `WEBS_HOME`
- `SRV_WEBS_HOME`
- `SELF_UPDATE_ENABLED` (bật/tắt cập nhật chính dashboard từ UI)
- `SELF_UPDATE_FOLDER` (tên folder project dashboard, mặc định `pdl-dashboard`)

## 4.1) Self-update cho chính dashboard

Sau khi cập nhật tay lần này, dashboard có thể tự cập nhật lần sau:

- UI có nút **Self Update** ở thanh top bar.
- Backend dùng `SELF_UPDATE_FOLDER` để chạy luồng `update` cho chính project này.
- Khi chạy self-update, backend/frontend có thể restart tạm thời, trình duyệt có thể mất kết nối vài giây.

## 5) Push lên GitHub đúng chuẩn

Repo đã cấu hình `.gitignore` để bỏ qua:
- `node_modules/`
- `server/node_modules/`
- `dist/`, `dist.tar.gz`
- `.env`, file log, state runtime

Nếu trước đó các file build đã từng track, hãy bỏ track trước khi commit:

```bash
git rm -r --cached node_modules server/node_modules dist dist.tar.gz || true
git add .
git commit -m "chore: normalize pdl-dashboard structure for github and run"
```

## 6) Deploy trên server

Backend đang gọi `manager.sh` để thao tác deploy project trong `${WEBS_HOME}` và `${SRV_WEBS_HOME}`.
Nếu server không dùng path mặc định, chỉ cần sửa `.env` trước khi `docker compose up`.
