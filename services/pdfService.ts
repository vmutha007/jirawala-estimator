
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { EstimateItem, BusinessProfile, CustomerProfile, EstimateRecord } from '../types';

// --- THEME CONFIGURATION (Liceria Style) ---
const THEME = {
  BG_COLOR: [253, 251, 247], // Light Beige/Cream
  ACCENT_COLOR: [200, 30, 30], // Bold Red
  TEXT_MAIN: [20, 20, 20], // Near Black
  TEXT_SEC: [80, 80, 80], // Dark Gray
  BORDER_COLOR: [50, 50, 50], // Dark borders for grid
  TABLE_HEAD_BG: [240, 235, 230], // Darker Beige for headers
};

const numberToWords = (num: number): string => {
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const inWords = (n: number): string => {
    const s = n.toString();
    if (s.length > 9) return 'overflow';
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

// --- Shared Drawing Helpers ---

const setupPage = (doc: jsPDF) => {
    const w = doc.internal.pageSize.width;
    const h = doc.internal.pageSize.height;
    doc.setFillColor(THEME.BG_COLOR[0], THEME.BG_COLOR[1], THEME.BG_COLOR[2]);
    doc.rect(0, 0, w, h, 'F');
};

const drawHeader = (doc: jsPDF, business: BusinessProfile, title: string, meta: string[], customer: CustomerProfile, isDraft: boolean) => {
    const pageWidth = doc.internal.pageSize.width;
    
    // 1. Main Title (Left, Huge, Red)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(48);
    doc.setTextColor(THEME.ACCENT_COLOR[0], THEME.ACCENT_COLOR[1], THEME.ACCENT_COLOR[2]);
    doc.text(title, 14, 35);

    // 2. Company Name (Right, Large, Red)
    doc.setFontSize(24);
    doc.text(business.name || "Jirawala Axis", pageWidth - 14, 30, { align: "right" });

    // 3. Company Info (Right, Gray)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(THEME.TEXT_SEC[0], THEME.TEXT_SEC[1], THEME.TEXT_SEC[2]);
    
    let yRight = 38;
    const addressLines = (business.address || "").split('\n');
    addressLines.forEach(line => {
        doc.text(line, pageWidth - 14, yRight, { align: "right" });
        yRight += 4;
    });
    if(business.phone) { doc.text(business.phone, pageWidth - 14, yRight, { align: "right" }); yRight += 4; }
    if(business.email) { doc.text(business.email, pageWidth - 14, yRight, { align: "right" }); yRight += 4; }
    if(business.gstin) { doc.text(`GSTIN: ${business.gstin}`, pageWidth - 14, yRight, { align: "right" }); yRight += 4; }

    // 4. Meta Info (Left, Under Title)
    let yLeft = 50;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(THEME.TEXT_MAIN[0], THEME.TEXT_MAIN[1], THEME.TEXT_MAIN[2]);
    
    meta.forEach(line => {
        const parts = line.split(':');
        if (parts.length > 1) {
             doc.text(`${parts[0]}:`, 14, yLeft);
             doc.setFont("helvetica", "normal");
             doc.text(parts[1], 45, yLeft);
             doc.setFont("helvetica", "bold");
        } else {
             doc.text(line, 14, yLeft);
        }
        yLeft += 5;
    });

    // 5. Bill To Section
    const billY = Math.max(yLeft, yRight) + 15;
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(THEME.TEXT_MAIN[0], THEME.TEXT_MAIN[1], THEME.TEXT_MAIN[2]);
    doc.text("Bill To:", 14, billY);
    
    // Payment Method / Terms Header (Right Side)
    doc.text("Terms / Notes:", pageWidth - 80, billY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(customer.firmName ? customer.firmName.toUpperCase() : customer.name.toUpperCase(), 14, billY + 6);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(THEME.TEXT_SEC[0], THEME.TEXT_SEC[1], THEME.TEXT_SEC[2]);
    
    let custY = billY + 11;
    if(customer.firmName && customer.name) {
        doc.text(customer.name, 14, custY);
        custY += 4;
    }
    if(customer.address) {
        const lines = doc.splitTextToSize(customer.address, 80);
        doc.text(lines, 14, custY);
        custY += (lines.length * 4);
    }
    if(customer.phone) { doc.text(`Ph: ${customer.phone}`, 14, custY); custY += 4; }
    if(customer.gstin) { doc.text(`GSTIN: ${customer.gstin}`, 14, custY); }

    // Right side content (Payment/Terms placeholder)
    const termsY = billY + 6;
    const terms = business.terms ? business.terms.split('\n').slice(0, 3) : ["Immediate Payment", "Non-refundable"];
    terms.forEach((t, i) => {
        doc.text(`• ${t}`, pageWidth - 80, termsY + (i*5));
    });

    // Watermark
    if (isDraft) {
        doc.setFontSize(80);
        doc.setTextColor(240, 230, 230); 
        doc.setFont("helvetica", "bold");
        const h = doc.internal.pageSize.height;
        doc.text("DRAFT", pageWidth / 2, h / 2, { align: 'center', angle: 45 });
    }

    return Math.max(custY, termsY + 20) + 10;
};

// --- MAIN INVOICE GENERATOR ---
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
  setupPage(doc);

  const dateStr = new Date().toLocaleDateString('en-IN');
  const title = isDraft ? "ESTIMATE" : "INVOICE";
  const meta = [
      `Invoice No : ${invoiceNumber || '---'}`,
      `Date       : ${dateStr}`,
      // Add Due Date if needed in future
  ];

  let yPos = drawHeader(doc, business, title, meta, customer, isDraft);

  // --- Table ---
  const tableBody = items.map((item, index) => {
    const sellingBasic = item.sellingBasic;
    const gstAmount = sellingBasic * (item.gstPercent / 100);
    const finalUnitRate = sellingBasic + gstAmount;
    const total = finalUnitRate * item.quantity;
    
    // Calculate discount % for display if selling < mrp
    let discText = "-";
    if (item.mrp > 0 && sellingBasic < item.mrp) {
        const d = ((item.mrp - sellingBasic) / item.mrp) * 100;
        if (d > 0.5) discText = `${d.toFixed(1)}%`;
    }

    return [
      (index + 1).toString(),
      item.productName,
      item.quantity.toString(),
      item.mrp > 0 ? item.mrp.toFixed(2) : '-',
      discText,
      sellingBasic.toFixed(2), 
      `${item.gstPercent}%`,
      total.toFixed(2)
    ];
  });

  // Calculate Totals
  const subTotal = items.reduce((sum, item) => {
    const sellingBasic = item.sellingBasic;
    const gstAmount = sellingBasic * (item.gstPercent / 100);
    return sum + ((sellingBasic + gstAmount) * item.quantity);
  }, 0);
  const grandTotal = subTotal + additionalCharges.packing + additionalCharges.shipping + additionalCharges.adjustment;
  const amountInWords = numberToWords(Math.round(grandTotal));

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'DESCRIPTION', 'QTY', 'MRP', 'DISC', 'RATE', 'GST', 'TOTAL']],
    body: tableBody,
    theme: 'grid', // Bold grid style
    styles: {
        textColor: THEME.TEXT_MAIN,
        lineColor: THEME.BORDER_COLOR,
        lineWidth: 0.1,
        fontSize: 9,
        cellPadding: 4,
        valign: 'middle'
    },
    headStyles: {
        fillColor: THEME.TABLE_HEAD_BG,
        textColor: THEME.TEXT_MAIN,
        fontStyle: 'bold',
        halign: 'center',
        lineColor: THEME.BORDER_COLOR,
        lineWidth: 0.1
    },
    columnStyles: {
        0: { halign: 'center', cellWidth: 12 },
        1: { halign: 'left' },
        2: { halign: 'center', cellWidth: 15 },
        3: { halign: 'right', cellWidth: 20 },
        4: { halign: 'center', cellWidth: 18 },
        5: { halign: 'right', cellWidth: 25 },
        6: { halign: 'center', cellWidth: 15 },
        7: { halign: 'right', cellWidth: 30, fontStyle: 'bold' }
    },
    footStyles: {
        fillColor: [255, 255, 255],
        textColor: THEME.TEXT_MAIN,
        lineColor: THEME.BORDER_COLOR,
        lineWidth: 0.1
    }
  });

  const finalY = (doc as any).lastAutoTable.finalY;
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  // --- Totals Section (Boxed on Right) ---
  let totalY = finalY + 10;
  
  // Check if page break needed
  if (totalY > pageHeight - 60) {
      doc.addPage();
      setupPage(doc);
      totalY = 20;
  }

  const rightColX = pageWidth - 80;
  
  // Helper to draw total row
  const drawTotalRow = (label: string, value: string, isBold = false, isRed = false) => {
      doc.setFont("helvetica", isBold ? "bold" : "normal");
      doc.setTextColor(isRed ? THEME.ACCENT_COLOR[0] : THEME.TEXT_MAIN[0], isRed ? THEME.ACCENT_COLOR[1] : THEME.TEXT_MAIN[1], isRed ? THEME.ACCENT_COLOR[2] : THEME.TEXT_MAIN[2]);
      doc.text(label, rightColX, totalY);
      doc.text(value, pageWidth - 14, totalY, { align: 'right' });
      totalY += 6;
  };

  doc.setFontSize(10);
  drawTotalRow("Sub Total", subTotal.toFixed(2));
  if(additionalCharges.packing > 0) drawTotalRow("Packing", `+${additionalCharges.packing.toFixed(2)}`);
  if(additionalCharges.shipping > 0) drawTotalRow("Shipping", `+${additionalCharges.shipping.toFixed(2)}`);
  if(additionalCharges.adjustment !== 0) drawTotalRow("Adjustment", `${additionalCharges.adjustment > 0 ? '+' : ''}${additionalCharges.adjustment.toFixed(2)}`);
  
  // Grand Total Bar
  totalY += 2;
  doc.setDrawColor(THEME.ACCENT_COLOR[0], THEME.ACCENT_COLOR[1], THEME.ACCENT_COLOR[2]);
  doc.setLineWidth(0.5);
  doc.line(rightColX - 5, totalY - 5, pageWidth - 14, totalY - 5);
  
  doc.setFontSize(14);
  drawTotalRow("GRAND TOTAL", grandTotal.toFixed(2), true, true);
  
  doc.line(rightColX - 5, totalY - 4, pageWidth - 14, totalY - 4);

  // Amount in Words (Left side)
  doc.setFontSize(9);
  doc.setTextColor(THEME.TEXT_SEC[0], THEME.TEXT_SEC[1], THEME.TEXT_SEC[2]);
  doc.setFont("helvetica", "italic");
  doc.text("Amount in Words:", 14, finalY + 10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(THEME.TEXT_MAIN[0], THEME.TEXT_MAIN[1], THEME.TEXT_MAIN[2]);
  const words = doc.splitTextToSize(amountInWords, 100);
  doc.text(words, 14, finalY + 15);

  // --- Footer ---
  const footerY = Math.max(totalY + 20, pageHeight - 40);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("For " + business.name, pageWidth - 14, footerY, { align: "right" });
  
  // Signature Line
  doc.setLineWidth(0.2);
  doc.setDrawColor(THEME.TEXT_SEC[0], THEME.TEXT_SEC[1], THEME.TEXT_SEC[2]);
  doc.line(pageWidth - 60, footerY + 25, pageWidth - 14, footerY + 25);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Authorized Signatory", pageWidth - 14, footerY + 30, { align: "right" });

  // Terms at very bottom left
  if (business.terms) {
      doc.text("Terms & Conditions:", 14, footerY + 10);
      doc.setFontSize(7);
      doc.setTextColor(THEME.TEXT_SEC[0], THEME.TEXT_SEC[1], THEME.TEXT_SEC[2]);
      const termLines = doc.splitTextToSize(business.terms, 120);
      doc.text(termLines, 14, footerY + 15);
  }

  const fileName = `${isDraft ? 'DRAFT_' : invoiceNumber ? invoiceNumber + '_' : 'ORDER_'}${customer.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
  if (action === 'print') {
      doc.autoPrint();
      window.open(doc.output('bloburl'), '_blank');
  } else {
      doc.save(fileName);
  }
};

// --- STATEMENT GENERATOR ---
export const generateStatementPDF = (
    customer: CustomerProfile,
    transactions: EstimateRecord[],
    business: BusinessProfile
) => {
    const doc = new jsPDF();
    setupPage(doc);

    const dateStr = new Date().toLocaleDateString('en-IN');
    const meta = [
        `Statement Date: ${dateStr}`,
        `Period: All Time`
    ];

    const yPos = drawHeader(doc, business, "STATEMENT", meta, customer, false);

    // --- Statement Table Logic ---
    interface LedgerRow {
        date: string;
        ref: string;
        desc: string;
        debit: string;
        credit: string;
        balance: number;
    }

    const rows: LedgerRow[] = [];
    let runningBalance = 0;
    const sortedTrans = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    sortedTrans.forEach(est => {
        const estTotal = est.items.reduce((sum, i) => sum + (i.sellingBasic * (1 + i.gstPercent/100) * i.quantity), 0) 
                        + est.additionalCharges.adjustment + est.additionalCharges.packing + est.additionalCharges.shipping;
        
        if (est.status === 'confirmed') {
            runningBalance += estTotal;
            rows.push({
                date: new Date(est.date).toLocaleDateString('en-IN'),
                ref: est.invoiceNumber || 'N/A',
                desc: 'Invoice Generated',
                debit: estTotal.toFixed(2),
                credit: '-',
                balance: runningBalance
            });
        }

        if (est.paymentHistory && est.paymentHistory.length > 0) {
            est.paymentHistory.forEach(pay => {
                runningBalance -= pay.amount;
                rows.push({
                    date: new Date(pay.date).toLocaleDateString('en-IN'),
                    ref: '-',
                    desc: pay.note || 'Payment Received',
                    debit: '-',
                    credit: pay.amount.toFixed(2),
                    balance: runningBalance
                });
            });
        } else if (est.amountPaid && est.amountPaid > 0) {
            runningBalance -= est.amountPaid;
            rows.push({
                date: new Date(est.lastModified).toLocaleDateString('en-IN'),
                ref: '-',
                desc: 'Payment Received',
                debit: '-',
                credit: est.amountPaid.toFixed(2),
                balance: runningBalance
            });
        }
    });

    const tableBody = rows.map(r => [r.date, r.ref, r.desc, r.debit, r.credit, r.balance.toFixed(2)]);

    autoTable(doc, {
        startY: yPos,
        head: [['DATE', 'REF #', 'DESCRIPTION', 'DEBIT', 'CREDIT', 'BALANCE']],
        body: tableBody,
        theme: 'grid',
        styles: {
            textColor: THEME.TEXT_MAIN,
            lineColor: THEME.BORDER_COLOR,
            lineWidth: 0.1,
            fontSize: 9,
            cellPadding: 4
        },
        headStyles: {
            fillColor: THEME.TABLE_HEAD_BG,
            textColor: THEME.TEXT_MAIN,
            fontStyle: 'bold',
            halign: 'center',
            lineColor: THEME.BORDER_COLOR,
            lineWidth: 0.1
        },
        columnStyles: {
            3: { halign: 'right', textColor: THEME.ACCENT_COLOR }, // Debit Red
            4: { halign: 'right', textColor: [22, 163, 74] }, // Credit Green
            5: { halign: 'right', fontStyle: 'bold' }
        }
    });

    const finalY = (doc as any).lastAutoTable.finalY;
    const pageWidth = doc.internal.pageSize.width;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Closing Balance:", pageWidth - 60, finalY + 15);
    
    doc.setFontSize(14);
    doc.setTextColor(runningBalance > 0 ? THEME.ACCENT_COLOR[0] : 22, runningBalance > 0 ? THEME.ACCENT_COLOR[1] : 163, runningBalance > 0 ? THEME.ACCENT_COLOR[2] : 74);
    doc.text(`${runningBalance.toFixed(2)}`, pageWidth - 14, finalY + 15, { align: "right" });

    const fileName = `STATEMENT_${customer.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
    doc.save(fileName);
};
