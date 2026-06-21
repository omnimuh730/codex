import { ObjectId } from "mongodb";
import { getDb, accountCollection } from "./db.mjs";
import {
  listResumeStacks,
  profileSummary,
  transformAutoBidProfile,
} from "./profiles.mjs";
import { attachResumeFromLibrary, listUserResumesWithContent } from "./user-resumes.mjs";

function parseId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

export async function listProfiles() {
  const db = await getDb();
  const docs = await accountCollection(db).find({}, { projection: { password: 0 } }).sort({ name: 1 }).toArray();
  return docs.map(profileSummary);
}

export async function getProfileById(id, { stackName, jobContext } = {}) {
  const oid = parseId(id);
  if (!oid) return null;
  const db = await getDb();
  const doc = await accountCollection(db).findOne({ _id: oid }, { projection: { password: 0 } });
  if (!doc) return null;
  const profile = transformAutoBidProfile(doc);
  return await attachResumeFromLibrary(profile, { stackName });
}

export async function getProfileResumes(id) {
  const oid = parseId(id);
  if (!oid) return null;
  const db = await getDb();
  const doc = await accountCollection(db).findOne({ _id: oid }, { projection: { autoBidProfile: 1, resumeCatalog: 1, name: 1 } });
  if (!doc) return null;
  const folder = doc.autoBidProfile?.resumeFolderUrl || "";
  const ownerId = String(doc._id);
  const uploaded = await listUserResumesWithContent(ownerId, { ownerName: doc.name });
  const mongoStacks = [...new Set(uploaded.map((r) => r.techStack).filter(Boolean))];
  return {
    id: ownerId,
    name: doc.name,
    resumeFolderUrl: folder,
    resumeDir: folder,
    stacks: mongoStacks.length ? mongoStacks : listResumeStacks(folder),
    catalog: Object.keys(doc.resumeCatalog || {}),
    resumes: uploaded.map((r) => ({
      id: String(r._id),
      techStack: r.techStack,
      fileName: r.fileName,
      mimeType: r.mimeType,
      isPrimary: Boolean(r.isPrimary),
      analyzed: Boolean(r.analyzed),
    })),
  };
}
