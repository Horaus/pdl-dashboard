#!/bin/bash
ACTION=$1
PROJECT_NAME=$2
FLOW=$3
PARAM=$4
PARAM2=$5

# Tìm kiếm thư mục dự án ở các vị trí phổ biến
if [ -d "/home/pdl1host/webs/$PROJECT_NAME" ]; then
    SRV_PATH="/home/pdl1host/webs/$PROJECT_NAME"
elif [ -d "/srv/webs/$PROJECT_NAME" ]; then
    SRV_PATH="/srv/webs/$PROJECT_NAME"
else
    # Mặc định tạo mới tại /home nếu chưa có
    SRV_PATH="/home/pdl1host/webs/$PROJECT_NAME"
fi

function setup_standard() {
    mkdir -p "$SRV_PATH"

    # Tự động nhận diện context (thư mục chứa mã nguồn)
    local context="source"
    if [ ! -d "$SRV_PATH/source" ]; then
        if [ -f "$SRV_PATH/package.json" ] || [ -f "$SRV_PATH/index.html" ]; then
            context="."
        fi
    fi

    if [ ! -f "$SRV_PATH/Dockerfile" ]; then
        echo "Creating Dockerfile for project $PROJECT_NAME (context: $context)..."
        if [ -f "$SRV_PATH/$context/package.json" ]; then
            # Hỗ trợ NodeJS/React/Vite/Next.js
            local dist_dir="dist"
            if grep -q "next" "$SRV_PATH/$context/package.json"; then
                dist_dir=".next"
            fi

            cat > "$SRV_PATH/Dockerfile" <<EOD
FROM node:20-alpine as build
WORKDIR /app
COPY $context/package*.json ./
RUN npm install
COPY $context/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/$dist_dir /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
EOD
        else
            # Hỗ trợ Web tĩnh (Static HTML)
            cat > "$SRV_PATH/Dockerfile" <<EOD
FROM nginx:alpine
COPY $context/ /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
EOD
        fi
    fi

    # Luôn tạo nginx.conf nếu chưa có
    if [ ! -f "$SRV_PATH/nginx.conf" ]; then
        cat > "$SRV_PATH/nginx.conf" <<EON
server {
    listen 80;
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
EON
    fi
}

function find_repo_path() {
    if [ -d "$SRV_PATH/source/.git" ]; then
      echo "$SRV_PATH/source"
      return
    fi
    if [ -d "$SRV_PATH/.git" ]; then
      echo "$SRV_PATH"
      return
    fi
    echo ""
}

function create_compose() {
    local port=$1
    local domain=$2
    local mode=$3
    local end_time=$4

    if [ "$mode" == "maintenance" ]; then
        local start_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

        # Tạo thư mục chứa file bảo trì riêng cho project
        mkdir -p "$SRV_PATH/maintenance"

        # Tạo file index.html từ template
        cp /home/pdl1host/webs/maintenance/template.html "$SRV_PATH/maintenance/index.html"

        # Thay thế placeholder nếu có end_time
        if [ -n "$end_time" ] && [ "$end_time" != "undefined" ]; then
            sed -i "s|{{END_TIME}}|$end_time|g" "$SRV_PATH/maintenance/index.html"
            sed -i "s|{{START_TIME}}|$start_time|g" "$SRV_PATH/maintenance/index.html"
        fi

        # Tạo cấu hình Nginx catch-all cho bảo trì
        cat > "$SRV_PATH/maintenance-nginx.conf" <<EEN
server {
    listen 80;
    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }
}
EEN

        # Maintenance mode (Production only)
        cat > "$SRV_PATH/docker-compose.yml" <<EOC
version: '3'
services:
  web:
    image: nginx:alpine
    container_name: web-${PROJECT_NAME}-maintenance
    restart: always
    volumes:
      - $SRV_PATH/maintenance/index.html:/usr/share/nginx/html/index.html:ro
      - $SRV_PATH/maintenance-nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - traefik_traefik_net
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${PROJECT_NAME}.rule=Host(\`$domain\`)"
      - "traefik.http.routers.${PROJECT_NAME}.entrypoints=web"
      - "traefik.http.services.${PROJECT_NAME}.loadbalancer.server.port=80"
      - "traefik.http.routers.${PROJECT_NAME}-secure.rule=Host(\`$domain\`)"
      - "traefik.http.routers.${PROJECT_NAME}-secure.entrypoints=websecure"
      - "traefik.http.routers.${PROJECT_NAME}-secure.tls=true"
      - "traefik.http.routers.${PROJECT_NAME}-secure.tls.certresolver=le"

networks:
  traefik_traefik_net:
    external: true
EOC
    elif [ -n "$port" ] && [ "$port" != "80" ] && [ -z "$domain" ]; then
        # Preview mode
        cat > "$SRV_PATH/docker-compose.yml" <<EOC
version: '3'
services:
  web:
    build: .
    ports:
      - "$port:80"
    restart: always
EOC
    else
        # Normal Production mode
        cat > "$SRV_PATH/docker-compose.yml" <<EOC
version: '3'
services:
  web:
    build: .
    container_name: web-${PROJECT_NAME}
    restart: always
    networks:
      - traefik_traefik_net
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${PROJECT_NAME}.rule=Host(\`$domain\`)"
      - "traefik.http.routers.${PROJECT_NAME}.entrypoints=web"
      - "traefik.http.services.${PROJECT_NAME}.loadbalancer.server.port=80"
      - "traefik.http.routers.${PROJECT_NAME}-secure.rule=Host(\`$domain\`)"
      - "traefik.http.routers.${PROJECT_NAME}-secure.entrypoints=websecure"
      - "traefik.http.routers.${PROJECT_NAME}-secure.tls=true"
      - "traefik.http.routers.${PROJECT_NAME}-secure.tls.certresolver=le"

networks:
  traefik_traefik_net:
    external: true
EOC
    fi
}

case $ACTION in
    "deploy")
        setup_standard
        if [ "$FLOW" == "preview" ]; then
            create_compose $PARAM "" "normal"
        else
            create_compose 80 $PARAM "normal"
        fi
        cd $SRV_PATH && docker compose up -d --build --remove-orphans
        ;;
    "offair")
        if [ -d "$SRV_PATH" ]; then
            create_compose 80 $FLOW "maintenance" "$PARAM"
            cd $SRV_PATH && docker compose up -d --remove-orphans
            echo "Project $PROJECT_NAME at $SRV_PATH is now in MAINTENANCE mode with custom template."
        else
            echo "Project $PROJECT_NAME path not found."
            exit 1
        fi
        ;;
    "update")
        if [ -d "$SRV_PATH/source" ]; then
            cd "$SRV_PATH/source" && git pull
            cd "$SRV_PATH" && docker compose up -d --build --no-cache
            echo "Project $PROJECT_NAME updated and rebuilt at $SRV_PATH."
        else
            echo "Project $PROJECT_NAME source path not found at $SRV_PATH/source."
            exit 1
        fi
        ;;
    "delete_soft")
        if [ -d "$SRV_PATH" ]; then
            cd "$SRV_PATH" && docker compose down --remove-orphans || true
            echo "Project $PROJECT_NAME has been soft-deleted (container stopped)."
        else
            echo "Project $PROJECT_NAME path not found."
            exit 1
        fi
        ;;
    "restore")
        if [ -d "$SRV_PATH" ]; then
            cd "$SRV_PATH" && docker compose up -d --build --remove-orphans
            echo "Project $PROJECT_NAME restored and running."
        else
            echo "Project $PROJECT_NAME path not found."
            exit 1
        fi
        ;;
    "delete_hard")
        if [ -d "$SRV_PATH" ]; then
            cd "$SRV_PATH" && docker compose down --remove-orphans || true
            rm -rf "$SRV_PATH"
            echo "Project $PROJECT_NAME hard-deleted."
        else
            echo "Project $PROJECT_NAME path not found."
            exit 1
        fi
        ;;
    "rollback_list")
        REPO_PATH=$(find_repo_path)
        if [ -z "$REPO_PATH" ]; then
            echo "Repository not found for rollback list."
            exit 1
        fi
        cd "$REPO_PATH" && git fetch --all --prune
        CURRENT_SHA=$(git rev-parse HEAD)
        echo "$CURRENT_SHA"
        git log --date=iso --pretty=format:'%H\t%an\t%ad\t%s' -n 20
        ;;
    "rollback_apply")
        SHA=$FLOW
        if [[ ! "$SHA" =~ ^[a-fA-F0-9]{7,40}$ ]]; then
            echo "Invalid SHA"
            exit 1
        fi
        REPO_PATH=$(find_repo_path)
        if [ -z "$REPO_PATH" ]; then
            echo "Repository not found for rollback apply."
            exit 1
        fi
        cd "$REPO_PATH" && git fetch --all --prune
        PRE_SHA=$(git rev-parse HEAD)
        echo "__PRE_SHA__:$PRE_SHA"
        git reset --hard "$SHA"
        cd "$SRV_PATH" && docker compose up -d --build --remove-orphans
        ;;
    "cleanup")
        docker system prune -f
        ;;
esac
