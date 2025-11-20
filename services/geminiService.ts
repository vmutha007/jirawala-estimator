
import { GoogleGenAI, Type } from "@google/genai";
import { InventoryItem } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const parseInvoicePDF = async (base64Pdf: string): Promise<Partial<InventoryItem>[]> => {
  if (!apiKey) {
    throw new Error("API Key is missing");
  }

  const model = "gemini-2.5-flash";

  const prompt = `
    Analyze this PDF invoice/purchase order (likely Indian GST format). 
    Extract the list of line items purchased. 
    
    IMPORTANT RULES:
    - If the invoice has multiple quantities for an item, extract the UNIT price, not the total line amount.
    - Look for "HSN/SAC" code if available, put it in the product name or notes.
    
    For each item, extract:
    - Product Name: Full description.
    - Vendor Name: Sender/Supplier name from header.
    - Date: Invoice Date (YYYY-MM-DD).
    - MRP: Maximum Retail Price per unit. If not listed, check if there is a "Rate" column that seems higher than the Net Rate. If MRP is unknown, set to 0.
    - Purchase Discount Percentage: The discount % given by vendor to buyer on this invoice.
    - GST Percentage: The tax rate (e.g., 18, 12, 28, 5). Look for CGST+SGST or IGST columns.
    - Landing Price: The final effective BASIC UNIT COST to the buyer (After discount, BEFORE tax). If the invoice lists a "Net Rate" or "Basic Rate", use that. 
    - Quantity: The number of units purchased. Default to 1 if not specified.

    Return a clean JSON array.
  `;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Pdf
            }
          },
          {
            text: prompt
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productName: { type: Type.STRING },
              vendor: { type: Type.STRING },
              date: { type: Type.STRING },
              mrp: { type: Type.NUMBER },
              purchaseDiscountPercent: { type: Type.NUMBER },
              gstPercent: { type: Type.NUMBER },
              landingPrice: { type: Type.NUMBER, description: "Unit basic cost after discount" },
              quantity: { type: Type.NUMBER, description: "Quantity purchased" }
            }
          }
        }
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      // Map the API response to our internal InventoryItem structure
      return data.map((item: any) => ({
        ...item,
        stock: item.quantity || 1 // Default to 1 if AI misses it, mapped to 'stock'
      }));
    }
    return [];
  } catch (error) {
    console.error("Gemini extraction error:", error);
    throw error;
  }
};
