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
const S3_BUCKET = process.env.S3_BUCKET || "xgame-app-data";

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
  const bucketName = "xgame-app-data";

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
  let { bucket } = req.body;

  if (!filename || !version) {
    return res.status(400).json({ error: "Missing filename hoặc version" });
  }

  // Nếu không truyền bucket prefix thì mặc định là ""
  const bucketPrefix = bucket ? `${bucket}/` : "";

  // Key sẽ là: <bucketPrefix><version>/<filename>
  const key = `${bucketPrefix}${version}/${filename}`;

  try {
    const url = await s3.getSignedUrlPromise("putObject", {
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      Expires: 60,
    });

    res.json({ url, key });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Không tạo được presigned URL", detail: err.message });
  }
});

// API xem lịch sử upload theo version và bucket prefix
app.get("/upload-history", async (req, res) => {
  const version = req.query.version || "default";
  const prefix = req.query.bucket ? `${req.query.bucket}/` : "";
  const s3Bucket = S3_BUCKET; // luôn là xgame-app-data

  const history = await getUploadHistoryFromS3(s3Bucket, prefix, version);
  res.json(history);
});

// Lấy danh sách file từ 1 version folder trên S3 với prefix
async function getUploadHistoryFromS3(
  bucketName,
  prefix = "",
  version = "default"
) {
  let allFiles = [];
  let continuationToken = null;

  try {
    do {
      const data = await s3
        .listObjectsV2({
          Bucket: bucketName,
          Prefix: prefix ? `${prefix}` : undefined,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
        .promise();
      console.log(
        `Lấy danh sách file từ bucket: ${bucketName}, prefix: ${prefix}, version: ${version}`,
        data
      );
      allFiles.push(...data.Contents);
      continuationToken = data.IsTruncated ? data.NextContinuationToken : null;
    } while (continuationToken);

    // Gom nhóm theo thư mục (version)
    const versionMap = {};

    for (const item of allFiles) {
      const key = item.Key;
      const parts = key.split("/");
      const ver = parts.length > 1 ? parts[1] : parts[0]; // lấy version sau prefix

      if (!versionMap[ver]) {
        versionMap[ver] = {
          version: ver,
          time: item.LastModified?.toISOString(),
          status: "success",
          message: "Upload và giải nén thành công!",
          files: [],
        };
      }

      if (key !== `${prefix}${ver}/`) {
        versionMap[ver].files.push(key);

        // Nếu file này có LastModified mới hơn -> cập nhật
        const currentLatest = new Date(versionMap[ver].time).getTime();
        const itemTime = new Date(item.LastModified).getTime();
        if (itemTime > currentLatest) {
          versionMap[ver].time = item.LastModified.toISOString();
        }
      }
    }

    // Sort theo thời gian cập nhật giảm dần
    return Object.values(versionMap).sort(
      (a, b) => new Date(b.time) - new Date(a.time)
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
