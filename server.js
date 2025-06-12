const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const AWS = require("aws-sdk");
const { uploadFileToS3 } = require("./aws-upload");
const { uploadFileToR2 } = require("./cloudflare-R2");
const { log } = require("console");
require("dotenv").config();
const S3_BUCKET= process.env.S3_BUCKET || "xgame-assets";

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
  const bucketName = "xgame-assets";

  try {
    if (!req.file) throw new Error("Không có file được upload.");

    const fileName = req.file.originalname;
    const s3Key = path.posix.join(version, fileName);

    await uploadFileToS3(req.file.path, bucketName, s3Key);
    res.send("Upload thành công!");
  } catch (err) {
    res.status(500).send("Upload thất bại: " + err.message);
  } finally {
    // Xóa file tạm sau khi upload
    fs.unlink(req.file.path, () => {});
  }
});


app.post("/get-presigned-url", async (req, res) => {
  console.log("Received request for presigned URL:", req.body);
  const { filename, contentType, version } = req.body;
  if (!filename || !version) {
    return res.status(400).json({ error: "Missing filename or version" });
  }

  const key = `${version}/${filename}`;

  const url = await s3.getSignedUrlPromise("putObject", {
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
    Expires: 60,
  });

  res.json({ url, key });
});

// app.post("/get-presigned-url", (req, res) => {
//   const { filename, version } = req.query;
//   const key = `${version}/${filename}`;

//   const params = {
//     Bucket: process.env.S3_BUCKET,
//     Key: key,
//     Expires: 60, // seconds
//     ContentType: "application/zip",
//   };

//   const url = s3.getSignedUrl("putObject", params);
//   res.json({ url, key });
// });

// API xem lịch sử upload theo version
app.get("/upload-history", async (req, res) => {
  const version = req.query.version || "default";
  const history = await getUploadHistoryFromS3("xgame-assets", version);
  res.json(history);
});

// Lấy danh sách file từ 1 version folder trên S3
async function getUploadHistoryFromS3(bucketName) {
  let allFiles = [];
  let continuationToken = null;

  try {
    // 1. Lấy toàn bộ object trong bucket (phân trang)
    do {
      const data = await s3
        .listObjectsV2({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
        .promise();

      allFiles.push(...data.Contents);
      continuationToken = data.IsTruncated ? data.NextContinuationToken : null;
    } while (continuationToken);

    // 2. Gom nhóm theo thư mục (version)
    const versionMap = {};

    for (const item of allFiles) {
      const key = item.Key;
      const parts = key.split("/");
      const version = parts[0]; // thư mục cha

      if (!versionMap[version]) {
        versionMap[version] = {
          version,
          time: item.LastModified?.toISOString(),
          status: "success",
          message: "Upload và giải nén thành công!",
          files: [],
        };
      }

      if (key !== `${version}/`) {
        versionMap[version].files.push(key);

        // Nếu file này có LastModified mới hơn -> cập nhật
        const currentLatest = new Date(versionMap[version].time).getTime();
        const itemTime = new Date(item.LastModified).getTime();
        if (itemTime > currentLatest) {
          versionMap[version].time = item.LastModified.toISOString();
        }
      }
    }

    // 3. Sort theo thời gian cập nhật giảm dần
    return Object.values(versionMap).sort(
      (a, b) => new Date(a.time) - new Date(b.time)
    );
  } catch (err) {
    console.error("Lỗi khi lấy lịch sử upload:", err);
    return [
      {
        version: "unknown",
        time: new Date().toISOString(),
        status: "error",
        message: err.message,
        files: [],
      },
    ];
  }
}

// Xử lý lỗi toàn cục
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).send("File quá lớn!");
  }
  res.status(500).send("Lỗi server: " + err.message);
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
