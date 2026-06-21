import { ObjectId } from "mongodb";
import { getDb, accountCollection } from "./db.mjs";
import {
  attachResumePath,
  listResumeStacks,
  profileSummary,
  transformAutoBidProfile,
} from "./profiles.mjs";

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
  return attachResumePath(profile, { stackName, jobContext });
}

export async function getProfileResumes(id) {
  const oid = parseId(id);
  if (!oid) return null;
  const db = await getDb();
  const doc = await accountCollection(db).findOne({ _id: oid }, { projection: { autoBidProfile: 1, resumeCatalog: 1, name: 1 } });
  if (!doc) return null;
  const folder = doc.autoBidProfile?.resumeFolderUrl || "";
  return {
    id: String(doc._id),
    name: doc.name,
    resumeFolderUrl: folder,
    resumeDir: folder,
    stacks: listResumeStacks(folder),
    catalog: Object.keys(doc.resumeCatalog || {}),
  };
}
