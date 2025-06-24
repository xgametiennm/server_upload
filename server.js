const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const AWS = require("aws-sdk");
require('dotenv').config(); 

const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT||"https://f83d3dc6d444c3c625dbb7043045ffbf.r2.cloudflarestorage.com"; // vd: "https://<accountid>.r2.cloudflarestorage.com"
const R2_BUCKET = process.env.R2_BUCKET || "xgame-app-data";

// Khởi tạo S3 client cho Cloudflare R2
console.log("Using R2 endpoint:", R2_ENDPOINT, R2_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY);

const r2 = new AWS.S3({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  endpoint: R2_ENDPOINT,
  signatureVersion: "v4",
  region: "auto",
  s3ForcePathStyle: true,
});

const { log } = require("console");
require("dotenv").config();

const app = express();
const HISTORY_FILE = "upload-history.json";
const s3 = new AWS.S3();
const upload = multer({
  dest: "upload/",
  limits: { fileSize: 100 * 1024 * 1024 },
});

app.use(express.static("."));
app.use(express.json());

// Upload file zip trực tiếp lên S3 (không giải nén)
app.post("/upload", upload.single("file"), async (req, res) => {
  const version = req.body.version || "default";
  const bucket = req.body.bucket || "fantasy"; // hoặc lấy từ client gửi lên
  const bucketName = R2_BUCKET;

  if (!req.file) {
    return res.status(400).send("Không có file được upload.");
  }

  // Thư mục giải nén tạm
  const extractPath = path.join("upload", `${bucket}_${version}_${Date.now()}`);
  try {
    // Giải nén file zip
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(extractPath, true);

    // Lấy danh sách file đã giải nén
    const files = fs.readdirSync(extractPath, { withFileTypes: true });
    let uploadedFiles = [];

    for (const file of files) {
      if (!file.isFile()) continue;
      const localPath = path.join(extractPath, file.name);
      // Key dạng: bucket/version/filename
      const r2Key = path.posix.join(bucket, version, file.name);

      await r2
        .upload({
          Bucket: bucketName,
          Key: r2Key,
          Body: fs.createReadStream(localPath),
          ContentType: "application/octet-stream",
        })
        .promise();

      uploadedFiles.push(r2Key);
    }

    res.send(`Upload và giải nén thành công! Đã upload: ${uploadedFiles.length} file.`);
  } catch (err) {
    res.status(500).send("Upload thất bại: " + err.message);
  } finally {
    // Xóa file zip và thư mục tạm
    fs.unlink(req.file.path, () => {});
    fs.rm(extractPath, { recursive: true, force: true }, () => {});
  }
});


// API xem lịch sử upload theo version và bucket prefix (Cloudflare R2)
app.get("/upload-history", async (req, res) => {
  // Nếu không truyền bucket và version thì lấy toàn bộ file trong bucket
  const version = req.query.version || "";
  const prefix = req.query.bucket ? `${req.query.bucket}/` : "";
  const r2Bucket = R2_BUCKET;

  try {
    const history = await getUploadHistoryFromR2(r2Bucket, prefix, version);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Không lấy được lịch sử upload", detail: err.message });
  }
});

// Lấy danh sách file từ 1 version folder trên R2 với prefix
async function getUploadHistoryFromR2(
  bucketName,
  prefix = "",
  version = ""
) {
  let allFiles = [];
  let continuationToken = null;

  // Nếu không truyền prefix và version thì lấy toàn bộ file trong bucket
  let r2Prefix = "";
  if (prefix && version) {
    r2Prefix = `${prefix}${version}/`;
  } else if (prefix) {
    r2Prefix = prefix;
  } else if (version) {
    r2Prefix = `${version}/`;
  } // nếu cả hai đều rỗng thì r2Prefix = ""

  try {
    do {
      console.log("Đang lấy object với Prefix:", r2Prefix);
      const data = await r2
        .listObjectsV2({
          Bucket: bucketName,
          Prefix: r2Prefix || undefined, // undefined sẽ lấy tất cả
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
        .promise();
      if (data.Contents && data.Contents.length > 0) {
        allFiles.push(...data.Contents);
      }
      continuationToken = data.IsTruncated ? data.NextContinuationToken : null;
    } while (continuationToken);

    if (allFiles.length === 0) {
      return [];
    }

    // Gom nhóm theo folder cha (phần trước dấu / đầu tiên)
    const folderMap = {};

    for (const item of allFiles) {
      const key = item.Key;
      const parts = key.split("/");
      const folder = parts[0] || "(root)";

      if (!folderMap[folder]) {
        folderMap[folder] = {
          folder: folder,
          files: [],
        };
      }
      folderMap[folder].files.push({
        key,
        lastModified: item.LastModified,
        size: item.Size,
        status: "uploaded", // Thêm trạng thái file ở đây
      });
    }

    // Trả về mảng các folder, mỗi folder chứa danh sách file
    return Object.values(folderMap);
  } catch (err) {
    console.error("Lỗi khi lấy danh sách object:", err);
    return [
      {
        folder: "unknown",
        files: [],
        error: err.message,
      },
    ];
  }
}

// API lấy danh sách bucket từ S3
app.get("/api/list-buckets", async (req, res) => {
  try {
    const data = await s3.listBuckets().promise();
    const buckets = data.Buckets.map((b) => b.Name);
    res.json(buckets);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Không lấy được danh sách bucket", detail: err.message });
  }
});

// Xử lý lỗi toàn cục
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).send("File quá lớn!");
  }
  res.status(500).send("Lỗi server: " + err.message);
});

app.listen(3034, () => console.log("Server running at http://localhost:3034"));
