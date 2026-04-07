import { NextResponse } from "next/server"

import {
  buildUploadedJobs,
  uploadPdfFile,
  type UploadJobsRequest,
} from "@/lib/job-actions"

const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024

function validatePdfUpload(file: File) {
  if (!file.name) {
    return "Missing file name"
  }

  if (
    file.type !== "application/pdf" &&
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return "Only PDF files are supported"
  }

  if (file.size === 0) {
    return "File is empty"
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File exceeds ${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB upload limit`
  }

  return null
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || ""

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData()
      const mode = formData.get("mode")
      const output = formData.get("output")
      const files = formData
        .getAll("files")
        .filter((entry): entry is File => entry instanceof File)

      if (
        (mode !== "LLM only" &&
          mode !== "Tesseract only" &&
          mode !== "Both compare") ||
        (output !== "Markdown" && output !== "Text" && output !== "MD + TXT")
      ) {
        return NextResponse.json(
          { message: "Invalid upload options" },
          { status: 400 }
        )
      }

      if (files.length === 0) {
        return NextResponse.json(
          { message: "No PDF files uploaded" },
          { status: 400 }
        )
      }

      const validationErrors = files.flatMap((file) => {
        const message = validatePdfUpload(file)

        return message ? [{ fileName: file.name || "upload.pdf", message }] : []
      })

      if (validationErrors.length > 0) {
        return NextResponse.json(
          {
            message: "One or more files failed validation",
            errors: validationErrors,
          },
          { status: 400 }
        )
      }

      const uploads = []

      for (const file of files) {
        try {
          uploads.push(await uploadPdfFile(file, mode, output))
        } catch (error) {
          console.error("[upload route] failed to process PDF", {
            fileName: file.name,
            error,
          })
          return NextResponse.json(
            {
              message: "Failed to process uploaded PDF",
              errors: [
                {
                  fileName: file.name || "upload.pdf",
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              ],
            },
            { status: 500 }
          )
        }
      }

      return NextResponse.json({
        jobs: uploads.map((entry) => entry.job),
        details: Object.fromEntries(
          uploads.map((entry) => [entry.job.id, entry.detail])
        ),
        errors: [],
      })
    }

    const payload = (await request.json()) as UploadJobsRequest
    const result = buildUploadedJobs(payload)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        message: "Unexpected upload failure",
        errors: [
          {
            fileName: "upload",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
      { status: 500 }
    )
  }
}
