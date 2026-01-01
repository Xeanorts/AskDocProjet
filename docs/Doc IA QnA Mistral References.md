The Document QnA capability combines OCR with large language model capabilities to enable natural language interaction with document content. This allows you to extract information and insights from documents by asking questions in natural language.

Workflow and Capabilities
<img width="3036" height="1452" alt="image" src="https://github.com/user-attachments/assets/3df7c19e-5328-4ebd-b0f5-900ae27162d0" />

Document Processing: OCR extracts text, structure, and formatting, creating a machine-readable version of the document.

Language Model Understanding: The extracted document content is analyzed by a large language model. You can ask questions or request information in natural language. The model understands context and relationships within the document and can provide relevant answers based on the document content.

Key Capabilities
Question answering about specific document content
Information extraction and summarization
Document analysis and insights
Multi-document queries and comparisons
Context-aware responses that consider the full document

Common use cases
Analyzing research papers and technical documents
Extracting information from business documents
Processing legal documents and contracts
Building document Q&A applications
Automating document-based workflows

QnA with an Uploaded PDF
Upload a file
import { Mistral } from '@mistralai/mistralai';
import fs from 'fs';

const apiKey = process.env.MISTRAL_API_KEY;

const client = new Mistral({apiKey: apiKey});

const uploadedFile = fs.readFileSync('2201.04234v3.pdf');
const uploadedPdf = await client.files.upload({
    file: {
        fileName: "2201.04234v3.pdf",
        content: uploadedFile,
    },
    purpose: "ocr"
});

Output
{
  "id": "9a90b93c-0e7d-4dd7-8520-07d051404d11",
  "object": "file",
  "bytes": 560027,
  "created_at": 1756754478,
  "filename": "1805.04770v2.pdf",
  "purpose": "ocr",
  "sample_type": "ocr_input",
  "num_lines": 0,
  "mimetype": "application/pdf",
  "source": "upload",
  "signature": "..."
}

Retrieve file
const retrievedFile = await client.files.retrieve({
    fileId: uploadedPdf.id
});

Output
{
  "id": "9a90b93c-0e7d-4dd7-8520-07d051404d11",
  "object": "file",
  "bytes": 560027,
  "created_at": 1756754478,
  "filename": "1805.04770v2.pdf",
  "purpose": "ocr",
  "sample_type": "ocr_input",
  "num_lines": 0,
  "mimetype": "application/pdf",
  "source": "upload",
  "signature": "...",
  "deleted": false
}

Get signed URL
const signedUrl = await client.files.getSignedUrl({
    fileId: uploadedPdf.id,
});
output
{
  "url": "https://mistralaifilesapiprodswe.blob.core.windows.net/fine-tune/.../.../9a90b93c0e7d4dd7852007d051404d11.pdf?se=2025-09-02T19%3A22%3A08Z&sp=r&sv=2025-01-05&sr=b&sig=..."
}

Get Chat Completion result
const chatResponse = await client.chat.complete({
  model: "mistral-small-latest",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "what is the last sentence in the document",
        },
        {
          type: "document_url",
          documentUrl: signedUrl.url,
        },
      ],
    },
  ],
});

Output
{
  "id": "4ccfdc97996241eb9fe4375d947c671b",
  "created": 1756754528,
  "model": "mistral-small-latest",
  "usage": {
    "prompt_tokens": 13707,
    "total_tokens": 13764,
    "completion_tokens": 57
  },
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "tool_calls": null,
        "content": "The last sentence in the document is:\n\n\"Zaremba, W., Sutskever, I., and Vinyals, O. Recurrent neural network regularization. arXiv:1409.2329, 2014.\""
      }
    }
  ]
}

Delete file
await client.files.delete(fileId=file.id);

Output
{
  "id": "9a90b93c-0e7d-4dd7-8520-07d051404d11",
  "object": "file",
  "deleted": true
}

Limits : 
Uploaded document files must not exceed 50 MB in size and should be no longer than 1,000 pages.

