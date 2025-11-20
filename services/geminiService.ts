import { GoogleGenAI, Type } from "@google/genai";
import { InventoryItem } from "../types";
// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';

// Initialize PDF Worker
try {
    // @ts-ignore
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
         // @ts-ignore
         pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs`;
    }
} catch (e) {
    console.warn("PDF.js setup failed", e);
}

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

// Helper: Convert PDF Page 1 to Image (Fast Upload)
const convertPdfToImage = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1); // Get first page

    const scale = 2.0; // High resolution for clear text
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (!context) throw new Error("Canvas context failed");

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    // Convert to JPEG (Compressed)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return dataUrl.split(',')[1];
};

// Helper: Read PDF as Base64 (Fallback)
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
  // Initialize client here to ensure env vars are ready
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY in your build configuration.");
  }
  
  const ai = new GoogleGenAI({ apiKey });

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
          mimeType = 'image/jpeg'; 
      } else if (isPdf) {
          // Optimize PDF handling
          // If PDF is > 1MB, it's likely a scan. Convert to image to save 90% bandwidth.
          // Even for text PDFs, converting to image ensures consistent AI vision processing.
          try {
              base64Data = await convertPdfToImage(file);
              mimeType = 'image/jpeg'; // Sending as image!
          } catch (e) {
              console.warn("PDF conversion failed, falling back to raw PDF upload", e);
              if (file.size > 10 * 1024 * 1024) {
                throw new Error("PDF is too large (>10MB) and conversion failed.");
              }
              base64Data = await readPdfAsBase64(file);
              mimeType = 'application/pdf';
          }
      }
  } catch (e) {
      console.error("File preparation failed", e);
      throw new Error("Failed to prepare file. Please try taking a photo instead.");
  }

  const model = "gemini-2.5-flash"; // Flash is fastest

  const prompt = `
    Analyze this invoice/purchase order. 
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