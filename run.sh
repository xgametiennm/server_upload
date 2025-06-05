#!/bin/bash

# Build lại Docker image
docker build -t upload-server .

# Dừng và xóa container cũ nếu đang chạy
docker rm -f my-upload-server 2>/dev/null

# Chạy lại container với tên my-upload-server, map port 3000
docker run -d --name my-upload-server -p 3000:3000 upload-server