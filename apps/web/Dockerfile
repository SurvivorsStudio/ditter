FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_BASE=/api
ENV VITE_API_BASE=$VITE_API_BASE

# 로컬 개발에서 로그인을 끄려면 false (백엔드 EAI_AUTH_ENABLED 와 짝). 기본은 로그인 필요.
ARG VITE_AUTH_ENABLED=true
ENV VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED

COPY package.json ./
RUN corepack enable && npm install

COPY . .
RUN npm run build

FROM nginx:1.31-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
