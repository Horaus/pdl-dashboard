FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache bash git docker-cli docker-cli-compose

COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3001
CMD ["node", "index.js"]

