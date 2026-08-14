import assert from "node:assert/strict";
import test from "node:test";
import { canIssueControlCommands, helloMatchesAccess, parseSocketAccess } from "./socket-access.js";

test("commentator mode is a distinct read-only socket role", () => {
  const access = parseSocketAccess("/socket?role=control&mode=commentator");
  assert.deepEqual(access, { requestedRole: "control", mode: "commentator", role: "commentator" });
  assert.equal(canIssueControlCommands(access!.role), false);
  assert.equal(helloMatchesAccess({ type: "hello", role: "control", mode: "commentator" }, access!), true);
  assert.equal(helloMatchesAccess({ type: "hello", role: "control", mode: "operator" }, access!), false);
});

test("operator control remains command-capable and invalid mode combinations fail closed", () => {
  const access = parseSocketAccess("/socket?role=control");
  assert.equal(access?.role, "control");
  assert.equal(canIssueControlCommands(access!.role), true);
  assert.equal(parseSocketAccess("/socket?role=overlay&mode=commentator"), null);
  assert.equal(parseSocketAccess("/socket?role=control&mode=unknown"), null);
});
