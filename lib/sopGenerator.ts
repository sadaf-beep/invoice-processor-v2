import { jsPDF } from 'jspdf';

export const downloadSOP = () => {
  const doc = new jsPDF();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('InvoiceIntel - AI Extraction Logic Details', 20, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  const content = `WORKFLOW LOGIC & SYSTEM PROMPT:

1. Dynamic Rules System:
- User Overrides take highest priority (e.g. custom directives like "ignore shipping", "PO # is always empty").
- The system dynamically generates a JSON schema based on the User's configured columns and asks Claude to conform to it exactly.

2. Line Item Extraction (Quantity Expansion Algorithm):
- Claude extracts "Quantity" for each line internally (defaults to 1 if not stated).
- Claude outputs ONE JSON object per unique line.
- Post-processing: For every line item, the app clones the object N times (where N = Quantity). E.g. A single row of "3x Laptops" becomes 3 distinct rows in the spreadsheet.

3. Standard Processing Rules (Applied if not overridden):
- Dates: Force MM/DD/YYYY format.
- Price: "Purchase Price" is strictly the Unit Price.
- Status: Forced to "Ordered" (never "New", "Pending", etc.) if column is present.

4. Item Classification Priority:
   1. Labour (Installation, service)
   2. Shipping (Freight, delivery)
   3. Prepaid (Software, warranties)
   4. Bulk Item (Passive, structural, cables, mounts)
   5. Asset (Active standalone electronics)
- Confidence Check: If classification is ambiguous, the system flags it as "REVIEW_REQUIRED".

5. Page Range Targeting:
- The system processes the entire file by default ("All").
- If a user inputs range (e.g., "1-3"), Claude focuses EXCLUSIVELY on line items physically visible on those pages.

6. Model:
- Extraction runs on Claude Opus (claude-opus-4-8) via the Anthropic API, using structured JSON-schema outputs so the response always matches the configured columns.`;

  const textLines = doc.splitTextToSize(content, 170);
  doc.text(textLines, 20, 35);

  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('System Documentation - InvoiceIntel (Claude Edition)', 20, 280);

  doc.save('Invoice_Extraction_Logic_SOP.pdf');
};
