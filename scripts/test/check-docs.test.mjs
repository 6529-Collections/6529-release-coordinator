import assert from "node:assert/strict";
import test from "node:test";
import { validateAdapterEvidence } from "../check-docs.mjs";

const gate = [
  "Use `adapter-success-path-YYYY-MM-DD.md`.",
  "Use `adapter-recovery-YYYY-MM-DD.md`."
].join("\n");
const pending = [
  "Pending: `adapter-success-path-YYYY-MM-DD.md`.",
  "Pending: `adapter-recovery-YYYY-MM-DD.md`."
].join("\n");

test("adapter evidence uses canonical dated names and progress links", () => {
  validateAdapterEvidence({ gate, progress: pending, testingFiles: [] });

  const success = "adapter-success-path-2026-09-21.md";
  const recovery = "adapter-recovery-2026-09-22.md";
  const progress = `${pending}\n[Success](./testing/${success})\n[Recovery](testing/${recovery}#result)`;
  validateAdapterEvidence({
    gate,
    progress,
    testingFiles: [success, recovery]
  });

  assert.throws(
    () =>
      validateAdapterEvidence({
        gate,
        progress: pending,
        testingFiles: ["adapter-recovery.md"]
      }),
    /dated canonical filename/u
  );
  assert.throws(
    () =>
      validateAdapterEvidence({
        gate,
        progress: pending,
        testingFiles: ["adapter-success-path-2026-13-01.md"]
      }),
    /dated canonical filename/u
  );
  assert.throws(
    () =>
      validateAdapterEvidence({
        gate,
        progress: `${pending}\n[Success](./testing/${success})`,
        testingFiles: []
      }),
    /link target is missing/u
  );
  assert.throws(
    () =>
      validateAdapterEvidence({
        gate,
        progress: pending,
        testingFiles: [success]
      }),
    /must be linked from docs\/progress\.md/u
  );
  assert.throws(
    () =>
      validateAdapterEvidence({
        gate,
        progress: `${pending}\n[Success](./testing/${success})\n[Again](testing/${success})`,
        testingFiles: [success]
      }),
    /link each adapter acceptance record once/u
  );
  assert.throws(
    () =>
      validateAdapterEvidence({
        gate,
        progress: `${pending}\n[Success](docs/testing/${success})`,
        testingFiles: [success]
      }),
    /must target testing/u
  );
  assert.throws(
    () =>
      validateAdapterEvidence({
        gate: "No filename contract.",
        progress: pending,
        testingFiles: []
      }),
    /retirement gate must prescribe/u
  );
});
