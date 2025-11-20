
import { GoogleGenAI, Type } from "@google/genai";
import { InventoryItem } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Helper: Compress Image to reduce payload size (Critical for mobile speed)
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Resize to max width 1024px - perfect for AI reading, small for upload
        const MAX_WIDTH = 1024; 
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            // Fallback to original if canvas fails
            resolve((event.target?.result as string).split(',')[1]);
            return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Convert to JPEG at 70% quality
        // This reduces a 5MB photo to ~200KB
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Helper: Read PDF as Base64
const readPdfAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
    });
};

export const parseInvoiceDocument = async (file: File): Promise<Partial<InventoryItem>[]> => {
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY in your build configuration.");
  }

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';

  if (!isImage && !isPdf) {
      throw new Error("Unsupported file type. Please upload a PDF or Image (JPG/PNG).");
  }

  let base64Data = '';
  let mimeType = '';

  try {
      if (isImage) {
          // Compress images for speed
          base64Data = await compressImage(file);
          mimeType = 'image/jpeg'; // We convert everything to jpeg in compressImage
      } else {
          // PDF handling
          if (file.size > 10 * 1024 * 1024) {
              throw new Error("PDF is too large (>10MB). Please compress it or use an image.");
          }
          base64Data = await readPdfAsBase64(file);
          mimeType = 'application/pdf';
      }
  } catch (e) {
      console.error("File preparation failed", e);
      throw new Error("Failed to prepare file for upload. It might be too large or corrupted.");
  }

  const model = "gemini-2.5-flash"; // Flash is fastest

  const prompt = `
    Analyze this ${isImage ? 'image' : 'PDF'} invoice/purchase order. 
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
              mimeType: mimeType,
              data: base64Data
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
