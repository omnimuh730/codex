import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ObjectId, GridFSBucket } from "mongodb";
import { getDb, userResumesCollection } from "./db.mjs";

function toOid(id) {
  if (!id) return null;
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

function getGridFsBucket(db) {
  return new GridFSBucket(db, { bucketName: "user_resume_files" });
}

async function readContent(db, doc) {
  if (doc.storage === "gridfs" && doc.gridFsId) {
    const bucket = getGridFsBucket(db);
    const chunks = [];
    await new Promise((resolve, reject) => {
      bucket
        .openDownloadStream(doc.gridFsId)
        .on("data", (chunk) => chunks.push(chunk))
        .on("error", reject)
        .on("end", resolve);
    });
    return Buffer.concat(chunks);
  }
  if (doc.contentBase64) {
    return Buffer.from(doc.contentBase64, "base64");
  }
  return null;
}

export async function resumeHasContent(db, doc) {
  try {
    const buf = await readContent(db, doc);
    return Boolean(buf?.length);
  } catch {
    return false;
  }
}

export async function listUserResumesForOwner(ownerId, { ownerName } = {}) {
  const db = await getDb();
  const oid = toOid(ownerId);
  const filter = oid
    ? { $or: [{ ownerId: oid }, ...(ownerName ? [{ ownerName }] : [])] }
    : ownerName
      ? { ownerName }
      : null;
  if (!filter) return [];

  return userResumesCollection(db)
    .find(filter)
    .sort({ isPrimary: -1, uploadedAt: -1 })
    .toArray();
}

export async function listUserResumesWithContent(ownerId, opts = {}) {
  const db = await getDb();
  const docs = await listUserResumesForOwner(ownerId, opts);
  const out = [];
  for (const doc of docs) {
    if (await resumeHasContent(db, doc)) out.push(doc);
  }
  return out;
}

export async function materializeResume(doc, destDir) {
  const db = await getDb();
  const buffer = await readContent(db, doc);
  if (!buffer?.length) return null;

  fs.mkdirSync(destDir, { recursive: true });
  const baseName = doc.fileName || `resume-${String(doc._id)}`;
  const safeName = path.basename(baseName).replace(/[^\w.\-()+ ]+/g, "_") || `resume-${String(doc._id)}`;
  const filePath = path.join(destDir, safeName);
  fs.writeFileSync(filePath, buffer);
  return {
    filePath,
    fileName: safeName,
    mimeType: doc.mimeType || "application/octet-stream",
  };
}

function pickResume(docs, { stackName } = {}) {
  if (!docs.length) return null;
  if (stackName) {
    const exact = docs.find((d) => d.techStack === stackName);
    if (exact) return exact;
    const lower = stackName.toLowerCase();
    const fuzzy = docs.find((d) => String(d.techStack || "").toLowerCase() === lower);
    if (fuzzy) return fuzzy;
  }
  return docs.find((d) => d.isPrimary) || docs[0];
}

export async function attachResumeFromLibrary(profile, { stackName, destDir } = {}) {
  const resumes = await listUserResumesWithContent(profile.accountId, {
    ownerName: profile.fullName || profile.accountName,
  });

  if (!resumes.length) {
    return {
      ...profile,
      resumeStack: "",
      resumePath: "",
      resumeId: "",
      resumeMimeType: "",
      resumeFileName: "",
      resumeCount: 0,
    };
  }

  const chosen = pickResume(resumes, { stackName });
  const dir =
    destDir ||
    path.join(os.tmpdir(), "nextoffer-resumes", profile.accountId || "unknown");
  const materialized = await materializeResume(chosen, dir);

  if (!materialized) {
    return {
      ...profile,
      resumeStack: chosen?.techStack || "",
      resumePath: "",
      resumeId: chosen ? String(chosen._id) : "",
      resumeMimeType: "",
      resumeFileName: "",
      resumeCount: resumes.length,
    };
  }

  return {
    ...profile,
    resumeStack: chosen.techStack || "",
    resumePath: materialized.filePath,
    resumeMimeType: materialized.mimeType,
    resumeFileName: materialized.fileName,
    resumeId: String(chosen._id),
    resumeCount: resumes.length,
  };
}
