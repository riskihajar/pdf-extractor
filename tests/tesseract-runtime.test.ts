import assert from "node:assert/strict"
import { chmod, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  buildTesseractCommand,
  getTesseractRuntimeStatus,
  runTesseractPage,
  testTesseractRuntimeConnection,
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

test("runTesseractPage executes binary and reads generated text", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tesseract-runner-"))
  const binaryPath = join(tempDir, "tesseract")
  const imagePath = join(tempDir, "page-1.png")

  await writeFile(
    binaryPath,
    '#!/bin/sh\nout="$2.txt"\nprintf \'OCR READY\\n\' > "$out"\n'
  )
  await chmod(binaryPath, 0o755)
  await writeFile(imagePath, "fake-image")

  const result = await runTesseractPage(imagePath, {
    binaryPath,
    language: "eng",
    dataPath: "",
  })

  assert.equal(result.text, "OCR READY")
  assert.equal(result.command, binaryPath)
  assert.deepEqual(result.args, [imagePath, result.args[1], "-l", "eng"])
})

test("runTesseractPage surfaces binary failure details", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tesseract-runner-fail-"))
  const binaryPath = join(tempDir, "tesseract")
  const imagePath = join(tempDir, "page-1.png")

  await writeFile(binaryPath, "#!/bin/sh\nprintf 'bad image' >&2\nexit 1\n")
  await chmod(binaryPath, 0o755)
  await writeFile(imagePath, "fake-image")

  await assert.rejects(
    () =>
      runTesseractPage(imagePath, {
        binaryPath,
        language: "eng",
        dataPath: "",
      }),
    /bad image/
  )
})

test("testTesseractRuntimeConnection reports missing binary", async () => {
  const result = await testTesseractRuntimeConnection({
    binaryPath: "/tmp/does-not-exist-tesseract",
    language: "eng",
    dataPath: "",
  })

  assert.equal(result.status, "error")
  assert.match(result.message, /tidak ditemukan/i)
})

test("testTesseractRuntimeConnection reports executable version", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "tesseract-test-"))
  const binaryPath = join(tempDir, "tesseract")

  await writeFile(binaryPath, "#!/bin/sh\nprintf 'tesseract 5.3.0\\n'\n")
  await chmod(binaryPath, 0o755)

  const result = await testTesseractRuntimeConnection({
    binaryPath,
    language: "eng",
    dataPath: "",
  })

  assert.equal(result.status, "ok")
  assert.match(result.version ?? "", /tesseract 5\.3\.0/)
})
