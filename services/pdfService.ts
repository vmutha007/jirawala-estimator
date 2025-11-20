
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EstimateItem, BusinessProfile, CustomerProfile } from '../types';

const numberToWords = (num: number): string => {
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const inWords = (n: number): string => {
    const s = n.toString();
    if (s.length > 9) return 'overflow';
    
    // Use slice instead of substr
    const padded = ('000000000' + s).slice(-9);
    const n_array = padded.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
    
    if (!n_array) return ''; 
    let str = '';
    
    const getPart = (idx: number, label: string) => {
        const val = Number(n_array[idx]);
        if (val === 0) return '';
        
        let txt = '';
        if (a[val]) {
            txt = a[val];
        } else {
            const digits = n_array[idx].split('');
            txt = b[Number(digits[0])] + ' ' + a[Number(digits[1])];
        }
        return txt + label;
    };

    str += getPart(1, 'Crore ');
    str += getPart(2, 'Lakh ');
    str += getPart(3, 'Thousand ');
    str += getPart(4, 'Hundred ');
    
    const lastPartVal = Number(n_array[5]);
    if (lastPartVal !== 0) {
        if (str !== '') str += 'and ';
        if (a[lastPartVal]) {
            str += a[lastPartVal];
        } else {
             const digits = n_array[5].split('');
             str += b[Number(digits[0])] + ' ' + a[Number(digits[1])];
        }
    }
    
    return str;
  };

  const parts = num.toString().split('.');
  let output = inWords(Number(parts[0])) + 'Rupees Only';
  
  if (parts[1]) {
    const paise = parseInt(parts[1].padEnd(2, '0').substring(0, 2));
    if (paise > 0) {
        output = inWords(Number(parts[0])) + 'Rupees and ' + inWords(paise) + 'Paise Only';
    }
  }
  
  return output;
};

export const generateEstimatePDF = (
    customer: CustomerProfile, 
    items: EstimateItem[], 
    business: BusinessProfile,
    additionalCharges: { packing: number; shipping: number; adjustment: number },
    isDraft: boolean = false,
    invoiceNumber?: string,
    action: 'download' | 'print' = 'download'
) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  // Colors
  const primaryColor = [37, 99, 235]; // Blue 600
  const slateColor = [71, 85, 105]; // Slate 600

  // --- Background Accents ---
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, pageWidth, 5, 'F');

  // Watermark for Draft
  if (isDraft) {
      doc.setFontSize(80);
      // Use light grey to simulate transparency without using potentially unsupported GState methods
      doc.setTextColor(230, 230, 230); 
      doc.setFont("helvetica", "bold");
      doc.text("DRAFT", pageWidth / 2, pageHeight / 2, { align: 'center', angle: 45 });
      doc.setTextColor(0); // Reset to black
  }

  // --- Header Section ---
  let yPos = 20;

  // Logo
  if (business.logoUrl) {
    try {
      doc.addImage(business.logoUrl, 'JPEG', 14, 14, 25, 25); 
    } catch (e) {
      console.error("Could not add logo", e);
    }
  }

  // Company Info (Right Aligned)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42); // Slate 900
  doc.text(business.name || "Jirawala Axis", pageWidth - 14, yPos, { align: "right" });
  yPos += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(slateColor[0], slateColor[1], slateColor[2]);
  
  const addressLines = (business.address || "").split('\n');
  addressLines.forEach(line => {
      doc.text(line, pageWidth - 14, yPos, { align: "right" });
      yPos += 4;
  });

  if (business.phone) { doc.text(`Ph: ${business.phone}`, pageWidth - 14, yPos, { align: "right" }); yPos += 4; }
  if (business.email) { doc.text(business.email, pageWidth - 14, yPos, { align: "right" }); yPos += 4; }
  if (business.gstin) { doc.text(`GSTIN: ${business.gstin}`, pageWidth - 14, yPos, { align: "right" }); yPos += 4; }

  // --- Document Title & Dates ---
  yPos = Math.max(yPos, 50) + 10;
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(isDraft ? "QUOTATION" : "TAX INVOICE", 14, yPos);

  // Metadata (Right side of title)
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "bold");
  
  let metaY = yPos - 5;
  if (!isDraft && invoiceNumber) {
      doc.text("Invoice No:", pageWidth - 60, metaY);
      doc.setFont("helvetica", "normal");
      doc.text(invoiceNumber, pageWidth - 14, metaY, { align: "right" });
      metaY += 5;
      doc.setFont("helvetica", "bold");
  }

  doc.text("Date:", pageWidth - 60, metaY);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString('en-IN'), pageWidth - 14, metaY, { align: "right" });

  yPos += 12;

  // --- Bill To Box ---
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.rect(14, yPos, pageWidth - 28, 36, 'F');
  doc.rect(14, yPos, pageWidth - 28, 36, 'S');

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.text("BILL TO", 20, yPos + 8);

  // Customer Name/Firm
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(customer.firmName ? customer.firmName.toUpperCase() : customer.name, 20, yPos + 16);
  
  // Customer Address
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(51, 65, 85);
  
  let detailsY = yPos + 21;
  if (customer.firmName && customer.name) {
      doc.text(`Attn: ${customer.name}`, 20, detailsY);
      detailsY += 4;
  }
  
  if (customer.address) {
      const custAddr = doc.splitTextToSize(customer.address, 110);
      doc.text(custAddr, 20, detailsY);
  }

  // Customer Contact (Right side of box)
  const col2X = 130;
  let contactY = yPos + 16;
  
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

  // --- Item Table ---
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

  // Calculations
  const subTotal = items.reduce((sum, item) => {
    const sellingBasic = item.sellingBasic;
    const gstAmount = sellingBasic * (item.gstPercent / 100);
    return sum + ((sellingBasic + gstAmount) * item.quantity);
  }, 0);

  const grandTotal = subTotal + additionalCharges.packing + additionalCharges.shipping + additionalCharges.adjustment;

  // Amount in Words
  const amountInWords = numberToWords(Math.round(grandTotal));

  // Footer Rows
  const footRows: any[] = [];
  
  const addFootRow = (label: string, value: number, isBold: boolean = false) => {
     if (value !== 0) {
        footRows.push([
            { content: label, colSpan: 7, styles: { halign: 'right' as const, fontStyle: isBold ? 'bold' : 'normal' } }, 
            { content: value.toFixed(2), styles: { fontStyle: isBold ? 'bold' : 'normal' } }
        ]);
     }
  };

  footRows.push([
      { content: 'Sub Total', colSpan: 7, styles: { halign: 'right' as const } },
      { content: subTotal.toFixed(2) }
  ]);

  addFootRow('Packing & Handling', additionalCharges.packing);
  addFootRow('Freight / Shipping', additionalCharges.shipping);
  addFootRow(additionalCharges.adjustment > 0 ? 'Surcharge' : 'Adjustment', additionalCharges.adjustment);
  
  footRows.push([
    { 
        content: 'GRAND TOTAL', 
        colSpan: 7, 
        styles: { 
            halign: 'right', 
            fontStyle: 'bold', 
            fillColor: [241, 245, 249], 
            textColor: [37, 99, 235], 
            fontSize: 11 
        } 
    }, 
    { 
        content: grandTotal.toFixed(2), 
        styles: { 
            fontStyle: 'bold', 
            fillColor: [241, 245, 249], 
            textColor: [37, 99, 235], 
            fontSize: 11 
        } 
    }
  ]);

  // Add Amount in Words row
  footRows.push([
      { 
          content: `Amount in Words:\n${amountInWords}`, 
          colSpan: 8, 
          styles: { 
              halign: 'left', 
              fontStyle: 'italic', 
              textColor: [100, 116, 139],
              fontSize: 9,
              cellPadding: 3
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
        fillColor: [241, 245, 249], 
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
        1: { cellWidth: 'auto' }, 
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

  const finalY = (doc as any).lastAutoTable.finalY + 15;

  // --- Terms & Footer ---
  if (finalY > pageHeight - 60) {
      doc.addPage();
      yPos = 20;
  } else {
      yPos = finalY;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(14, yPos, pageWidth - 14, yPos);
  yPos += 10;

  // Terms
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text("Terms & Conditions:", 14, yPos);
  yPos += 6;

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  
  const terms = business.terms ? business.terms.split('\n') : [
    "1. Goods once sold will not be taken back.",
    "2. Interest @ 24% p.a. will be charged if payment is not made within the stipulated time.",
    "3. Subject to local jurisdiction."
  ];

  terms.forEach(term => {
    doc.text(term, 14, yPos);
    yPos += 4;
  });

  // Signatory
  const signY = Math.max(yPos, finalY);
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.text("For " + (business.name || "Jirawala Axis"), pageWidth - 14, signY, { align: "right" });
  
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.setFont("helvetica", "normal");
  doc.text("Authorized Signatory", pageWidth - 14, signY + 15, { align: "right" });

  const fileName = `${isDraft ? 'DRAFT_' : invoiceNumber ? invoiceNumber + '_' : 'ORDER_'}${customer.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;

  if (action === 'print') {
      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
  } else {
      doc.save(fileName);
  }
};
