import Anthropic from "@anthropic-ai/sdk";
import { InvoiceItem, ColumnConfig } from "../types";

// Internal interface that includes Quantity for processing logic
interface RawInvoiceItem extends InvoiceItem {
  Quantity?: number;
}

const MODEL = "claude-opus-4-8";

export const processInvoiceWithClaude = async (
  base64Data: string,
  mimeType: string,
  columns: ColumnConfig[],
  customInstructions: string,
  pageRange: string
): Promise<InvoiceItem[]> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key is missing. Please set ANTHROPIC_API_KEY in .env.local.");
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  const cleanBase64 = base64Data.replace(/^data:.+;base64,/, "");

  const columnNames = columns.map((c) => `"${c.label}"`).join(", ");

  const dynamicSystemInstruction = `
    You are an expert Invoice Processing AI with advanced reasoning capabilities.

    TASK:
    Extract line items from the invoice into a structured JSON array matching the required schema.

    COLUMNS TO EXTRACT:
    ${columnNames}

    *** PRIORITY INSTRUCTION ***
    The "USER OVERRIDES" section below contains custom business rules.
    IF ANY INSTRUCTION IN "USER OVERRIDES" CONFLICTS WITH THE "DEFAULT RULES",
    YOU MUST FOLLOW THE "USER OVERRIDES" AND IGNORE THE DEFAULT RULE.

    === USER OVERRIDES (HIGHEST PRIORITY) ===
    ${customInstructions ? customInstructions : "No custom overrides provided."}
    =========================================

    === DEFAULT RULES (Apply only if not overridden) ===
    1. **EXTRACT QUANTITY:** You MUST extract the "Quantity" for each line internally (integer). If not explicitly listed, imply it is 1.
    2. Output ONE object per unique line item found on the invoice. DO NOT split items into multiple rows yourself.
    3. Dates must be MM/DD/YYYY.
    4. "Purchase Price" should be the unit price.
    5. **STATUS:** If the columns list includes "Status", the value must ALWAYS be "Ordered". Never use "New", "Pending", or any other status.

    MANUFACTURER, MODEL #, PRODUCT NAME RULES:
    1. MANUFACTURER: The actual equipment maker. Do not infer if not stated.
    2. MODEL #: Official manufacturer part number (MPN). Do not use internal codes or row numbers.
    3. PRODUCT NAME: Provide the full product name as it appears on the invoice, but DO NOT include the manufacturer or model number. Only the name itself.
    4. DISAMBIGUATION: Manufacturer-labeled part number > Model #.

    ITEM CLASSIFICATION (Order of Operations):
    1. LABOUR (Installation, service)
    2. SHIPPING (Freight, delivery)
    3. PREPAID (Software, warranties)
    4. BULK ITEM (Passive, structural, cables, mounts)
    5. ASSET (Active standalone electronics)

    Confidence Check: If classification is ambiguous, output "REVIEW_REQUIRED".
    ====================================================

    PAGE RANGE INSTRUCTION:
    The user has requested to process the following page range: "${pageRange}".
    If this says "All", process every page.
    If it specifies a range (e.g., "1-3"), ONLY extract items visible on those specific pages.

    Return a JSON array conforming exactly to the provided schema. Every property listed is required on every item — use an empty string ("") for text fields with no value, and 0 for numeric fields with no value.
  `;

  // Dynamically build the JSON schema for structured output
  const properties: Record<string, { type: string }> = {
    Quantity: { type: "integer" },
  };
  const requiredFields = ["Quantity"];

  columns.forEach((col) => {
    properties[col.label] = { type: col.type === "number" ? "number" : "string" };
    requiredFields.push(col.label);
  });

  const isImage = mimeType.startsWith("image/");
  const documentBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam = isImage
    ? { type: "image", source: { type: "base64", media_type: mimeType as any, data: cleanBase64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } };

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: dynamicSystemInstruction,
      messages: [
        {
          role: "user",
          content: [
            documentBlock,
            {
              type: "text",
              text: `Extract every invoice line item. Focus strictly on page range: ${pageRange}. Follow USER OVERRIDES above all else.`,
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "array",
            items: {
              type: "object",
              properties,
              required: requiredFields,
              additionalProperties: false,
            },
          },
        },
      },
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("No response from Claude.");

    const rawData: RawInvoiceItem[] = JSON.parse(textBlock.text);
    const expandedData: InvoiceItem[] = [];

    // Row expansion logic — flatten "Quantity: N" into N individual rows
    const userAskedForQuantity = columns.some((c) => c.label.toLowerCase() === "quantity");

    rawData.forEach((item) => {
      const qty = item.Quantity && item.Quantity > 0 ? item.Quantity : 1;

      const outputItem = { ...item };
      if (!userAskedForQuantity) {
        delete outputItem.Quantity;
      }

      for (let i = 0; i < qty; i++) {
        expandedData.push(outputItem);
      }
    });

    return expandedData;
  } catch (error) {
    console.error("Claude API Error:", error);
    throw error;
  }
};
