
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

// Helper: Compress Image
// Updated: Increased MAX_WIDTH and Quality for better OCR accuracy
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // High resolution for accuracy (2500px width covers most full-page docs well)
        const MAX_WIDTH = 2500; 
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = height * (MAX_WIDTH / width);
          width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            // Fallback to original if canvas fails
            resolve((event.target?.result as string).split(',')[1]);
            return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // High quality JPEG (0.85) to prevent artifacts affecting numbers
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

// Helper: Convert PDF Page 1 to Image
// Updated: Uses higher scale for clarity
const convertPdfToImage = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1); // Get first page

    // Calculate scale for 2500px width (High fidelity)
    const desiredWidth = 2500;
    const viewportRaw = page.getViewport({ scale: 1.0 });
    const scale = desiredWidth / viewportRaw.width;
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

    // 0.9 Quality for very clear text
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return dataUrl.split(',')[1];
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
          // Compress images slightly but keep high res
          base64Data = await compressImage(file);
          mimeType = 'image/jpeg'; 
      } else if (isPdf) {
          // ACCURACY FIX:
          // Prefer sending the RAW PDF bytes if the file is reasonably sized (< 6MB).
          // This allows the AI to access the text layer directly (100% accurate) rather than relying on OCR (Vision).
          if (file.size < 6 * 1024 * 1024) {
              console.log("Uploading raw PDF for maximum accuracy");
              base64Data = await readPdfAsBase64(file);
              mimeType = 'application/pdf';
          } else {
              // Only convert to image if file is huge, but use High Res now.
              console.log("PDF large, converting to High-Res Image");
              try {
                  base64Data = await convertPdfToImage(file);
                  mimeType = 'image/jpeg'; 
              } catch (e) {
                  console.warn("PDF conversion failed, falling back to raw PDF", e);
                  if (file.size > 10 * 1024 * 1024) {
                    throw new Error("PDF is too large (>10MB) and conversion failed.");
                  }
                  base64Data = await readPdfAsBase64(file);
                  mimeType = 'application/pdf';
              }
          }
      }
  } catch (e) {
      console.error("File preparation failed", e);
      throw new Error("Failed to prepare file. Please try taking a photo instead.");
  }

  const model = "gemini-2.5-flash"; 

  const prompt = `
    You are an expert data extraction assistant for inventory management.
    Analyze this invoice or purchase order document accurately.
    
    EXTRACT the list of line items purchased.
    
    CRITICAL RULES FOR ACCURACY:
    1. **Unit Price / Landing Price**: Find the 'Rate', 'Unit Cost', or 'Basic' column. Do NOT use the 'Amount' or 'Total' column which is (Rate * Qty). We need the price of ONE unit.
    2. **MRP**: Look for an 'MRP' column. If it does not exist, check if the 'Rate' is significantly higher than the 'Net Rate'. If no MRP is clearly listed, return 0. DO NOT GUESS.
    3. **Discount**: Look for 'Disc %' or 'Discount'. If listed as an amount, calculate the percentage based on the rate.
    4. **GST**: Look for 'GST %', 'IGST', 'CGST', 'SGST'. If multiple columns exist (e.g. CGST 9% + SGST 9%), sum them (18%).
    5. **Product Name**: Capture the full description, including size, dimensions (e.g. 18mm, 8x4), and brand if available.
    
    For each item, return a JSON object with:
    - productName: Full string description.
    - vendor: The supplier name at the top of the invoice.
    - date: Invoice Date (YYYY-MM-DD).
    - mrp: Maximum Retail Price (0 if not found).
    - purchaseDiscountPercent: The discount percentage (0 if none).
    - gstPercent: The total tax rate (e.g. 18).
    - landingPrice: The BASIC UNIT RATE after discount but BEFORE tax. (Net Rate).
    - quantity: The quantity purchased.

    Return ONLY a valid JSON array.
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
              landingPrice: { type: Type.NUMBER, description: "Basic Unit Rate (After Disc, Before Tax)" },
              quantity: { type: Type.NUMBER }
            }
          }
        }
      }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return data.map((item: any) => ({
        ...item,
        stock: item.quantity || 1 
      }));
    }
    return [];
  } catch (error) {
    console.error("Gemini extraction error:", error);
    throw error;
  }
};
