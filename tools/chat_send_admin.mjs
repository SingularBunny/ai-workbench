// Sends one chat message to a session as the Control UI owner does: with operator.admin, which `/acp spawn` and
// other owner-only slash commands need (`openclaw gateway call chat.send` asks for operator.write only).
// Used by tools/container_check_junie.sh; run it with OpenClaw's own node so the package resolves:
//   node chat_send_admin.mjs <openclaw package dir> <session key> <message> [<idempotency key>]
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pkg, sessionKey, message, key = `aiwb-${Date.now()}`] = process.argv.slice(2);
const { callGatewayFromCli } = await import(pathToFileURL(path.join(pkg, "dist/plugin-sdk/gateway-runtime.js")).href);
const res = await callGatewayFromCli("chat.send", { json: true, timeout: "60000" },
  { sessionKey, message, deliver: false, idempotencyKey: key }, { scopes: ["operator.admin"], progress: false });
console.log(JSON.stringify(res));
