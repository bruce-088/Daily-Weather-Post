import jsPDF from "jspdf";

export function generateMasterPromptPdf(content: string): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  let y = 0;

  const colors = {
    headerBg: [15, 15, 20] as [number, number, number],
    headerText: [255, 255, 255] as [number, number, number],
    primary: [139, 92, 246] as [number, number, number],
    body: [30, 30, 35] as [number, number, number],
    muted: [120, 120, 130] as [number, number, number],
    footerBg: [15, 15, 20] as [number, number, number],
    line: [139, 92, 246] as [number, number, number],
  };

  const addFooter = (pageNum: number, totalPages: number) => {
    doc.setFillColor(...colors.footerBg);
    doc.rect(0, pageHeight - 12, pageWidth, 12, "F");
    doc.setFontSize(7);
    doc.setTextColor(...colors.muted);
    doc.text("WeatherPost App Specification", margin, pageHeight - 5);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: "right" });
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 18) {
      doc.addPage();
      y = 12;
    }
  };

  // Header
  doc.setFillColor(...colors.headerBg);
  doc.rect(0, 0, pageWidth, 28, "F");
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...colors.headerText);
  doc.text("WeatherPost — App Specification", margin, 14);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...colors.muted);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, margin, 22);
  y = 36;

  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("# ")) {
      // Skip the main title (already in header)
      continue;
    }

    if (trimmed.startsWith("## ")) {
      ensureSpace(16);
      y += 6;
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...colors.primary);
      doc.text(trimmed.replace(/^## /, ""), margin, y);
      y += 2;
      doc.setDrawColor(...colors.line);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + contentWidth * 0.4, y);
      y += 6;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      ensureSpace(12);
      y += 4;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...colors.body);
      doc.text(trimmed.replace(/^### /, ""), margin, y);
      y += 5;
      continue;
    }

    if (trimmed === "---") {
      y += 3;
      continue;
    }

    if (trimmed.startsWith("```")) {
      continue;
    }

    if (trimmed.startsWith("|")) {
      ensureSpace(6);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...colors.body);
      const cells = trimmed.split("|").filter(Boolean).map((c) => c.trim());
      if (cells.every((c) => /^[-:]+$/.test(c))) continue; // separator row

      const isHeader = lines[lines.indexOf(line) + 1]?.trim().startsWith("|") &&
        lines[lines.indexOf(line) + 1]?.includes("---");

      if (isHeader) {
        doc.setFont("helvetica", "bold");
      }

      const colWidth = contentWidth / Math.max(cells.length, 1);
      cells.forEach((cell, i) => {
        const cellText = cell.replace(/\\/g, "").replace(/`/g, "");
        doc.text(cellText, margin + i * colWidth, y, { maxWidth: colWidth - 2 });
      });
      y += 4.5;
      continue;
    }

    if (trimmed === "") {
      y += 2;
      continue;
    }

    // Body text
    ensureSpace(6);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.body);

    const cleaned = trimmed
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`(.*?)`/g, "$1")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")");

    const prefix = trimmed.startsWith("- ") ? "• " : trimmed.match(/^\d+\./) ? trimmed.match(/^\d+\./)?.[0] + " " : "";
    const text = prefix ? prefix + cleaned.replace(/^[-\d.]+\s*/, "") : cleaned;

    const splitLines = doc.splitTextToSize(text, contentWidth);
    for (const sl of splitLines) {
      ensureSpace(5);
      doc.text(sl, margin + (prefix ? 2 : 0), y);
      y += 4;
    }
  }

  // Add footers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(i, totalPages);
  }

  return doc;
}
