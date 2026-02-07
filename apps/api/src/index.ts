import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const { buildApp } = await import("./app.js");

const app = buildApp();

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
