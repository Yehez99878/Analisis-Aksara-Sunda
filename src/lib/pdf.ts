import jsPDF from 'jspdf';
import type { RecognitionResult } from './model';

export function generatePDF(result: RecognitionResult) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const margin = 40;
  let y = margin;
  const pageWidth = doc.internal.pageSize.getWidth();

  // Background
  doc.setFillColor(26, 58, 58); // #1a3a3a
  doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), 'F');

  // Gold accent
  doc.setFillColor(212, 175, 55); // #d4af37
  doc.rect(0, 0, pageWidth, 15, 'F');

  // Title
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Hasil OCR Aksara Sunda', pageWidth / 2, y + 40, { align: 'center' });
  
  y += 70;

  // Date
  doc.setTextColor(176, 196, 222); // #b0c4de
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const now = new Date().toLocaleDateString('id-ID');
  doc.text(`Tanggal: ${now}`, pageWidth / 2, y, { align: 'center' });

  y += 40;

  // Content helper
  const addText = (text: string, isTitle = false) => {
    if (isTitle) {
      doc.setTextColor(212, 175, 55);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      y += 10;
    } else {
      doc.setTextColor(232, 232, 232); // #e8e8e8
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
    }
    
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
    lines.forEach((line: string) => {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        doc.setFillColor(26, 58, 58);
        doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), 'F');
        y = margin;
      }
      doc.text(line, margin, y);
      y += 16;
    });
    y += 5; // spacing after block
  };

  addText('Transkripsi', true);
  addText(result.transkripsi || 'Tidak ada transkripsi');
  
  y += 15;

  addText('Aksara Terdeteksi', true);
  if (result.aksaraTerdeteksi && result.aksaraTerdeteksi.length > 0) {
    const listText = result.aksaraTerdeteksi.map(a => 
      `- ${a.aksara} (${a.latin}) - ${(a.confidence * 100).toFixed(1)}%`
    ).join('\n');
    addText(listText);
  } else {
    addText('Tidak ada aksara yang terdeteksi');
  }

  y += 15;

  if (result.catatan) {
    addText('Catatan', true);
    addText(result.catatan);
  }

  // Footer
  doc.setTextColor(212, 175, 55);
  doc.setFontSize(9);
  doc.text('Dibuat dengan Aksara Sunda OCR - AI Powered', pageWidth / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' });

  doc.save(`aksara_sunda_ocr_${Date.now()}.pdf`);
}
