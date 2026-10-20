# DermaScan frontend — Vite build served by nginx (SPA fallback).
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
# The browser talks to the host-published ports, so localhost defaults are right
# for the one-machine Docker setup. Override at build time if deploying elsewhere.
ARG VITE_API_URL=http://localhost:5000
ARG VITE_ML_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL \
    VITE_ML_URL=$VITE_ML_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
