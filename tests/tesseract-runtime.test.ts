import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  buildTesseractCommand,
  getTesseractRuntimeStatus,
} from "@/lib/tesseract-runtime"

test("buildTesseractCommand includes language and optional tessdata dir", () => {
  const command = buildTesseractCommand("/tmp/page-1.png", "/tmp/out/page-1", {
    binaryPath: "/opt/homebrew/bin/tesseract",
    language: "ind",
    dataPath: "/opt/homebrew/share/tessdata",
  })

  assert.equal(command.command, "/opt/homebrew/bin/tesseract")
  assert.deepEqual(command.args, [
    "/tmp/page-1.png",
    "/tmp/out/page-1",
    "-l",
    "ind",
    "--tessdata-dir",
    "/opt/homebrew/share/tessdata",
  ])
})

test("getTesseractRuntimeStatus reports missing binary when file is absent", async () => {
  const status = await getTesseractRuntimeStatus({
    binaryPath: "/tmp/does-not-exist-tesseract",
    language: "eng",
    dataPath: "",
  })

  assert.equal(status.status, "missing_binary")
  assert.equal(status.hasDataPath, false)
})

test("getTesseractRuntimeStatus reports ready when binary path exists", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tesseract-runtime-"))
  const binaryPath = join(tempDir, "tesseract")

  await writeFile(binaryPath, "#!/bin/sh\nexit 0\n")

  const status = await getTesseractRuntimeStatus({
    binaryPath,
    language: "eng",
    dataPath: "/tmp/tessdata",
  })

  assert.equal(status.status, "ready")
  assert.equal(status.hasDataPath, true)
  assert.equal(status.binaryPath, binaryPath)
})
