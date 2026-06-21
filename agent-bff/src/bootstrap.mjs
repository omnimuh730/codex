import { CONFIG } from "./config.mjs";

// Align core-backend library with BFF Mongo settings before any db import.
if (!process.env.MONGODB_URI) process.env.MONGODB_URI = CONFIG.mongoUri;
if (!process.env.MONGODB_DB) process.env.MONGODB_DB = CONFIG.mongoDb;
