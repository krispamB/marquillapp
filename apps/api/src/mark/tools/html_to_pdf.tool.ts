import { tool } from 'ai';
import z from 'zod';
import { htmlToPdf } from '../utils/html_to_pdf.util';
import { uploadFile } from 'src/s3';

export const createhtmlToPdfTool = () =>
  tool({
    description:
      'Convert a validated HTML artifact into a PDF and upload it to storage. ' +
      'Only call this after validate_artifact returns valid, and only for document requests. ' +
      'Returns the storage URL on success. If this tool fails, do not call save_to_db — report the error to the user.',
    inputSchema: z.object({
      html: z.string().describe('The validated HTML content to convert to PDF'),
      filename: z
        .string()
        .describe('The desired output filename without extension'),
    }),
    execute: async ({ html, filename }) => {
      // integrate with Puppeteer, wkhtmltopdf, PDFShift, etc.
      const pdfBuffer = await htmlToPdf(html);

      // upload to S3 or storage, return URL
      const uuid = crypto.randomUUID();
      return await uploadFile(
        `${uuid}_${filename}`,
        pdfBuffer,
        'application/pdf',
      );
    },
  });
