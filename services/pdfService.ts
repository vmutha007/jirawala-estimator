
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EstimateItem, BusinessProfile, CustomerProfile } from '../types';

export const generateEstimatePDF = (
    customer: CustomerProfile, 
    items: EstimateItem[], 
    business: BusinessProfile,
    additionalCharges: { packing: number; shipping: number; adjustment: number },
    isDraft: boolean = false,
    invoiceNumber?: string
) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  // Colors
  const primaryColor = [30, 64, 175]; // Dark Blue

  // --- Background Accents ---
  // Top color bar
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, pageWidth, 4, 'F');

  // Watermark
  if (isDraft) {
      doc.setFontSize(80);
      doc.setTextColor(240, 240, 240);
      doc.setFont("helvetica", "bold");
      // Cast to any to bypass strict TS check for withGraphicsState
      (doc as any).withGraphicsState({ opacity: 0.5 } as any, () => {
        doc.text("DRAFT", pageWidth / 2, pageHeight / 2, { align: 'center', angle: 45 });
      });
      doc.setTextColor(0); // Reset
  }

  // --- Header Section ---
  let yPos = 20;

  // Logo (Left)
  if (business.logoUrl) {
    try {
      doc.addImage(business.logoUrl, 'JPEG', 14, 14, 30, 30); 
    } catch (e) {
      console.error("Could not add logo", e);
    }
  }

  // Company Info (Right)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59); // Slate 800
  doc.text(business.name || "Jirawala Estimator", pageWidth - 14, yPos, { align: "right" });
  yPos += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105); // Slate 600
  
  const addressLines = (business.address || "").split('\n');
  addressLines.forEach(line => {
      doc.text(line, pageWidth - 14, yPos, { align: "right" });
      yPos += 4;
  });

  if (business.phone) { doc.text(`Ph: ${business.phone}`, pageWidth - 14, yPos, { align: "right" }); yPos += 4; }
  if (business.email) { doc.text(business.email, pageWidth - 14, yPos, { align: "right" }); yPos += 4; }
  if (business.gstin) { doc.text(`GSTIN: ${business.gstin}`, pageWidth - 14, yPos, { align: "right" }); yPos += 4; }

  // --- Invoice Title & Dates ---
  yPos = Math.max(yPos, 50) + 10;
  
  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(isDraft ? "QUOTATION" : "TAX INVOICE", 14, yPos);

  // Invoice # and Date Info
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "bold");
  
  let metaY = yPos;
  if (!isDraft && invoiceNumber) {
      doc.text("Invoice No:", pageWidth - 50, metaY);
      doc.setFont("helvetica", "normal");
      doc.text(invoiceNumber, pageWidth - 14, metaY, { align: "right" });
      metaY += 5;
      doc.setFont("helvetica", "bold");
  }

  doc.text("Date:", pageWidth - 50, metaY);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString(), pageWidth - 14, metaY, { align: "right" });

  yPos += 10;

  // --- Bill To Section ---
  doc.setDrawColor(226, 232, 240); // Border color
  doc.setFillColor(248, 250, 252); // Background
  doc.rect(14, yPos, pageWidth - 28, 35, 'F');
  doc.rect(14, yPos, pageWidth - 28, 35, 'S');

  // Label
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO", 20, yPos + 6);

  // Customer Details
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(customer.firmName ? customer.firmName.toUpperCase() : customer.name, 20, yPos + 13);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  // If firm name exists, show person name below it, else show address
  let detailsY = yPos + 18;
  if (customer.firmName) {
      doc.text(`Attn: ${customer.name}`, 20, detailsY);
      detailsY += 5;
  }
  
  if (customer.address) {
      const custAddr = doc.splitTextToSize(customer.address, 100);
      doc.text(custAddr, 20, detailsY);
      detailsY += (custAddr.length * 5);
  }

  // Contact Info Column in Bill To
  const col2X = 120;
  let contactY = yPos + 13;
  if (customer.phone) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text("Phone:", col2X, contactY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      doc.text(customer.phone, col2X + 20, contactY);
      contactY += 5;
  }
  if (customer.gstin) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text("GSTIN:", col2X, contactY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(15, 23, 42);
      doc.text(customer.gstin, col2X + 20, contactY);
  }

  yPos += 45;

  // --- Table ---
  const tableBody = items.map((item, index) => {
    const sellingBasic = item.sellingBasic;
    const gstAmount = sellingBasic * (item.gstPercent / 100);
    const finalUnitRate = sellingBasic + gstAmount;
    const total = finalUnitRate * item.quantity;
    
    let discountDisplay = "";
    if (item.mrp > 0 && sellingBasic < item.mrp) {
        const disc = ((item.mrp - sellingBasic) / item.mrp) * 100;
        discountDisplay = `${disc.toFixed(1)}%`;
    }

    return [
      index + 1,
      item.productName,
      item.quantity,
      item.mrp > 0 ? item.mrp.toFixed(2) : '-',
      discountDisplay,
      sellingBasic.toFixed(2), 
      `${item.gstPercent}%`,
      total.toFixed(2)
    ];
  });

  // Calculation
  const subTotal = items.reduce((sum, item) => {
    const sellingBasic = item.sellingBasic;
    const gstAmount = sellingBasic * (item.gstPercent / 100);
    return sum + ((sellingBasic + gstAmount) * item.quantity);
  }, 0);

  const grandTotal = subTotal + additionalCharges.packing + additionalCharges.shipping + additionalCharges.adjustment;

  // Footer Rows Construction
  const footRows: any[] = [];
  
  const addFootRow = (label: string, value: number, isBold: boolean = false) => {
     if (value !== 0) {
        footRows.push([
            { content: label, colSpan: 7, styles: { halign: 'right' as const, fontStyle: isBold ? 'bold' : 'normal' } }, 
            { content: value.toFixed(2), styles: { fontStyle: isBold ? 'bold' : 'normal' } }
        ]);
     }
  };

  // Subtotal
  footRows.push([
      { content: 'Sub Total', colSpan: 7, styles: { halign: 'right' as const } },
      { content: subTotal.toFixed(2) }
  ]);

  addFootRow('Packing & Handling', additionalCharges.packing);
  addFootRow('Freight / Shipping', additionalCharges.shipping);
  addFootRow(additionalCharges.adjustment > 0 ? 'Surcharge' : 'Adjustment', additionalCharges.adjustment);
  
  // Grand Total with Emphasis
  footRows.push([
    { 
        content: 'GRAND TOTAL', 
        colSpan: 7, 
        styles: { 
            halign: 'right', 
            fontStyle: 'bold', 
            fillColor: [241, 245, 249], 
            textColor: [30, 64, 175], 
            fontSize: 12 
        } 
    }, 
    { 
        content: grandTotal.toFixed(2), 
        styles: { 
            fontStyle: 'bold', 
            fillColor: [241, 245, 249], 
            textColor: [30, 64, 175], 
            fontSize: 12 
        } 
    }
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Item Description', 'Qty', 'MRP', 'Disc', 'Rate (Basic)', 'GST', 'Total']],
    body: tableBody,
    foot: footRows,
    theme: 'plain',
    styles: { 
        fontSize: 9, 
        cellPadding: 3, 
        lineColor: [226, 232, 240], 
        lineWidth: 0.1,
        textColor: [51, 65, 85]
    },
    headStyles: { 
        fillColor: [248, 250, 252], 
        textColor: [71, 85, 105], 
        fontStyle: 'bold',
        lineWidth: 0
    },
    footStyles: {
        halign: 'right',
        textColor: [15, 23, 42]
    },
    columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 'auto' }, // Description
        2: { cellWidth: 15, halign: 'center' },
        3: { cellWidth: 20, halign: 'right' },
        4: { cellWidth: 15, halign: 'right' },
        5: { cellWidth: 25, halign: 'right' },
        6: { cellWidth: 15, halign: 'right' },
        7: { cellWidth: 30, halign: 'right' }
    },
    didDrawPage: (data) => {
        if (data.cursor) {
            yPos = data.cursor.y;
        }
    }
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;

  // --- Footer Terms ---
  if (finalY > pageHeight - 50) {
      doc.addPage();
      yPos = 20;
  } else {
      yPos = finalY;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(14, yPos, pageWidth - 14, yPos);
  yPos += 10;

  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text("Terms & Conditions:", 14, yPos);
  yPos += 6;

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  
  const terms = business.terms ? business.terms.split('\n') : [
    "1. Goods once sold will not be taken back.",
    "2. Interest @ 24% p.a. will be charged if payment is not made within the stipulated time.",
    "3. Subject to local jurisdiction."
  ];

  terms.forEach(term => {
    doc.text(term, 14, yPos);
    yPos += 5;
  });

  // Signature Area
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text("For " + (business.name || "Jirawala Estimator"), pageWidth - 14, yPos, { align: "right" });
  yPos += 20;
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Authorized Signatory", pageWidth - 14, yPos, { align: "right" });

  doc.save(`${isDraft ? 'DRAFT_' : invoiceNumber ? invoiceNumber + '_' : 'ORDER_'}${customer.name.replace(/\s+/g, '_')}.pdf`);
};
