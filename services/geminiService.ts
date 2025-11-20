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
    Analyze this PDF invoice/purchase order. 
    Extract the list of items purchased.
    For each item, extract:
    - Product Name
    - Vendor Name (from the header/sender)
    - Date of Invoice (YYYY-MM-DD)
    - MRP (Maximum Retail Price per unit). If not explicitly stated, estimate or look for "Rate" and assume it might be MRP if high, otherwise use 0.
    - Purchase Discount Percentage (the discount given by vendor to buyer).
    - GST Percentage (tax rate).
    - Landing Price (The final basic unit cost after discount but BEFORE tax, or if the document lists a "Net Rate" use that).

    Return a JSON array.
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
              landingPrice: { type: Type.NUMBER, description: "Unit basic cost after discount" }
            }
          }
        }
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return data;
    }
    return [];
  } catch (error) {
    console.error("Gemini extraction error:", error);
    throw error;
  }
};