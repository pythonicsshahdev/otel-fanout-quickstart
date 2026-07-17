FROM node:20-alpine AS backend-deps
WORKDIR /app
COPY backend/package.json ./
RUN npm install --production

FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache nodejs

COPY --from=backend-deps /app/node_modules /app/backend/node_modules
COPY backend/ /app/backend/
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8090

CMD sh -c "node /app/backend/server.js & nginx -g 'daemon off;'"
