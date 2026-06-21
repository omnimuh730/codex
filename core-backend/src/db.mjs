import { MongoClient } from "mongodb";
import { CONFIG } from "./config.mjs";

let client;
let db;

export async function getDb() {
  if (db) return db;
  client = new MongoClient(CONFIG.mongoUri);
  await client.connect();
  db = client.db(CONFIG.mongoDb);
  return db;
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

export function accountCollection(dbConn) {
  return dbConn.collection("account_info");
}

export function agentRunsCollection(dbConn) {
  return dbConn.collection("agent_runs");
}

export function agentRunEventsCollection(dbConn) {
  return dbConn.collection("agent_run_events");
}

export function userResumesCollection(dbConn) {
  return dbConn.collection("user_resumes");
}
