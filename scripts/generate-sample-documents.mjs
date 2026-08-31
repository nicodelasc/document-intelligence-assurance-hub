// Caveat font source: https://github.com/googlefonts/caveat
// Licence: SIL Open Font License 1.1, copied to assets/fonts/Caveat-OFL.txt
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const samplesDirectory = resolve(projectDirectory, "public", "samples");
const sampleOverridesDirectory = resolve(
  projectDirectory,
  "assets",
  "sample-overrides",
);
const fixtureSource = resolve(projectDirectory, "src", "domain", "fixtures.ts");
const texturePath = resolve(samplesDirectory, "scanned-paper-texture.png");
const handwritingFontPath = resolve(
  projectDirectory,
  "assets",
  "fonts",
  "Caveat-VariableFont_wght.ttf",
);
const generatedAt = new Date("2026-08-28T00:00:00.000Z");
const pageWidth = 595.28;
const pageHeight = 841.89;
const approvedOverrideFilenames = new Set([
  "invoice-unreadable-approval.pdf",
  "warehouse-unreadable-damage-note.pdf",
]);

async function loadSyntheticFixtures() {
  const source = await readFile(fixtureSource, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  return (await import(moduleUrl)).syntheticFixtures;
}

async function preparePageTexture(textureBytes) {
  const source = await loadImage(textureBytes);
  const canvas = createCanvas(Math.round(pageWidth), Math.round(pageHeight));
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, pageWidth, pageHeight);
  return canvas.toBuffer("image/jpeg", 62);
}

function toSeed(value) {
  return [...value].reduce(
    (seed, character) => (seed * 31 + character.charCodeAt(0)) >>> 0,
    17,
  );
}

function textValue(value) {
  return value ?? "Not provided";
}

function drawTextFitted(page, text, options) {
  const { font, size, maxWidth, ...position } = options;
  let fittedSize = size;
  while (font.widthOfTextAtSize(text, fittedSize) > maxWidth && fittedSize > 6)
    fittedSize -= 0.25;
  page.drawText(text, { ...position, font, size: fittedSize });
}

async function createBaseDocument(fixture) {
  const document = await PDFDocument.create();
  document.setTitle(fixture.title);
  document.setAuthor("Document Intelligence Assurance Hub");
  document.setSubject("Synthetic operational document fixture");
  document.setKeywords(["synthetic", "sample", fixture.id]);
  document.setProducer("Document Intelligence Assurance Hub");
  document.setCreator("Document Intelligence Assurance Hub");
  document.setCreationDate(generatedAt);
  document.setModificationDate(generatedAt);
  return document;
}

async function loadAssets(document, textureBytes) {
  return {
    helvetica: await document.embedFont(StandardFonts.Helvetica),
    helveticaBold: await document.embedFont(StandardFonts.HelveticaBold),
    texture: await document.embedJpg(textureBytes),
    navy: rgb(0.09, 0.17, 0.3),
    slate: rgb(0.32, 0.38, 0.45),
    line: rgb(0.76, 0.78, 0.81),
    paleBlue: rgb(0.95, 0.97, 0.99),
  };
}

function drawPageFrame(page, assets) {
  page.drawImage(assets.texture, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    opacity: 0.11,
  });
  page.drawRectangle({
    x: 27,
    y: 23,
    width: pageWidth - 54,
    height: pageHeight - 46,
    color: rgb(1, 1, 1),
    opacity: 0.93,
    borderColor: rgb(0.66, 0.69, 0.73),
    borderWidth: 0.9,
  });
}

function drawDocumentHeader(page, assets, details) {
  page.drawText("OPERATIONS SAMPLE", {
    x: 48,
    y: 790,
    font: assets.helveticaBold,
    size: 8,
    color: assets.slate,
  });
  page.drawText(details.documentType, {
    x: 48,
    y: 758,
    font: assets.helveticaBold,
    size: 18,
    color: assets.navy,
  });
  drawTextFitted(page, details.organization, {
    x: 48,
    y: 737,
    font: assets.helvetica,
    size: 11,
    maxWidth: 310,
    color: assets.slate,
  });
  drawTextFitted(page, details.identifier, {
    x: 385,
    y: 758,
    font: assets.helveticaBold,
    size: 10,
    maxWidth: 160,
    color: assets.navy,
  });
  page.drawLine({
    start: { x: 48, y: 720 },
    end: { x: 547, y: 720 },
    thickness: 1,
    color: assets.line,
  });
}

function drawKeyValueGrid(page, assets, pairs) {
  const firstRowY = 665;
  const columnWidth = 244;
  pairs.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 48 + column * 254;
    const y = firstRowY - row * 45;
    page.drawText(label.toUpperCase(), {
      x,
      y: y + 25,
      font: assets.helveticaBold,
      size: 7,
      color: assets.slate,
    });
    page.drawRectangle({
      x,
      y,
      width: columnWidth,
      height: 20,
      color: rgb(0.995, 0.997, 1),
      borderColor: assets.line,
      borderWidth: 0.65,
    });
    drawTextFitted(page, textValue(value), {
      x: x + 8,
      y: y + 6,
      font: assets.helvetica,
      size: 9,
      maxWidth: columnWidth - 16,
      color: rgb(0.12, 0.16, 0.21),
    });
  });
}

function drawSectionHeading(page, assets, title, y) {
  page.drawText(title.toUpperCase(), {
    x: 48,
    y,
    font: assets.helveticaBold,
    size: 8,
    color: assets.slate,
  });
  page.drawLine({
    start: { x: 48, y: y - 6 },
    end: { x: 547, y: y - 6 },
    thickness: 0.7,
    color: assets.line,
  });
}

function drawTable(page, assets, { headings, rows, widths, y }) {
  const x = 48;
  const headerHeight = 18;
  const rowHeight = 23;
  let offset = 0;
  headings.forEach((heading, index) => {
    page.drawRectangle({
      x: x + offset,
      y: y - headerHeight,
      width: widths[index],
      height: headerHeight,
      color: assets.paleBlue,
      borderColor: assets.line,
      borderWidth: 0.55,
    });
    drawTextFitted(page, heading.toUpperCase(), {
      x: x + offset + 5,
      y: y - 12,
      font: assets.helveticaBold,
      size: 6.6,
      maxWidth: widths[index] - 10,
      color: assets.slate,
    });
    offset += widths[index];
  });
  rows.slice(0, 3).forEach((row, rowIndex) => {
    let cellOffset = 0;
    row.forEach((cell, index) => {
      const cellY = y - headerHeight - rowHeight * (rowIndex + 1);
      page.drawRectangle({
        x: x + cellOffset,
        y: cellY,
        width: widths[index],
        height: rowHeight,
        color: rgb(1, 1, 1),
        borderColor: assets.line,
        borderWidth: 0.45,
      });
      drawTextFitted(page, textValue(cell), {
        x: x + cellOffset + 5,
        y: cellY + 8,
        font: assets.helvetica,
        size: 8,
        maxWidth: widths[index] - 10,
        color: rgb(0.12, 0.16, 0.21),
      });
      cellOffset += widths[index];
    });
  });
}

function drawInvoiceLineItems(page, assets, lineItems) {
  drawSectionHeading(page, assets, "Invoice line items", 568);
  drawTable(page, assets, {
    headings: ["Description", "Qty", "Unit price", "Amount"],
    widths: [254, 55, 90, 100],
    y: 550,
    rows: lineItems.map((item) => [
      item.description,
      item.quantity,
      item.unitPrice,
      item.amount,
    ]),
  });
}

function drawInvoiceTotals(page, assets, financials) {
  [
    ["Subtotal", financials.subtotal],
    ["Tax", financials.tax],
    ["Invoice total", financials.invoiceTotal],
  ].forEach(([label, value], index) => {
    const y = 424 - index * 19;
    page.drawText(label, {
      x: 386,
      y,
      font: index === 2 ? assets.helveticaBold : assets.helvetica,
      size: 8,
      color: assets.slate,
    });
    drawTextFitted(page, value, {
      x: 458,
      y,
      font: index === 2 ? assets.helveticaBold : assets.helvetica,
      size: 8,
      maxWidth: 89,
      color: assets.navy,
    });
  });
}

function drawReceivingTable(page, assets, receivingRows) {
  drawSectionHeading(page, assets, "Receiving details", 568);
  drawTable(page, assets, {
    headings: ["Item code", "Lot", "Expected", "Received", "Damaged"],
    widths: [160, 132, 70, 70, 67],
    y: 550,
    rows: receivingRows.map((row) => [
      row.itemCode,
      row.lotNumber,
      row.expected,
      row.received,
      row.damaged,
    ]),
  });
}

function drawQuantitySummary(page, assets, quantities) {
  [
    ["Expected", quantities.expected],
    ["Received", quantities.received],
    ["Damaged", quantities.damaged],
  ].forEach(([label, value], index) => {
    const x = 48 + index * 168;
    page.drawRectangle({
      x,
      y: 398,
      width: 151,
      height: 39,
      color: index === 2 ? rgb(1, 0.97, 0.94) : assets.paleBlue,
      borderColor: assets.line,
      borderWidth: 0.55,
    });
    page.drawText(label.toUpperCase(), {
      x: x + 9,
      y: 421,
      font: assets.helveticaBold,
      size: 6.5,
      color: assets.slate,
    });
    page.drawText(textValue(value), {
      x: x + 9,
      y: 405,
      font: assets.helveticaBold,
      size: 12,
      color: assets.navy,
    });
  });
}

async function renderHandwriting(note, { seed, unclear }) {
  const canvas = createCanvas(1500, 220);
  const context = canvas.getContext("2d");
  context.font = "52px Caveat";
  context.fillStyle = "rgba(24, 62, 122, 0.86)";
  context.rotate((((seed % 5) - 2) * Math.PI) / 360);
  context.fillText(note, 34, 118);
  if (unclear) {
    context.strokeStyle = "rgba(24, 62, 122, 0.64)";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(260, 72);
    context.bezierCurveTo(520, 154, 760, 30, 1120, 134);
    context.stroke();
  }
  return canvas.toBuffer("image/png");
}

async function drawCommentsBox(document, page, assets, fixture, label) {
  const x = 48;
  const y = 229;
  const width = 499;
  const height = 133;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.99, 0.992, 0.996),
    borderColor: assets.line,
    borderWidth: 0.8,
  });
  page.drawText(label.toUpperCase(), {
    x: x + 12,
    y: y + height - 19,
    font: assets.helveticaBold,
    size: 7,
    color: assets.slate,
  });
  const evidence = fixture.handwrittenEvidence;
  if (evidence === null) {
    const typedComment =
      fixture.documentData.reviewer_comments ??
      fixture.documentData.receiver_comments;
    drawTextFitted(page, textValue(typedComment), {
      x: x + 14,
      y: y + 62,
      font: assets.helvetica,
      size: 11,
      maxWidth: width - 28,
      color: assets.navy,
    });
    return;
  }
  const handwriting = await renderHandwriting(evidence.text, {
    seed: toSeed(fixture.id),
    unclear: evidence.legibility === "unclear",
  });
  const image = await document.embedPng(handwriting);
  page.drawImage(image, {
    x: x + 12,
    y: y + 24,
    width: width - 24,
    height: 73,
  });
}

function drawSyntheticFooter(page, assets, fixtureId) {
  page.drawLine({
    start: { x: 48, y: 78 },
    end: { x: 547, y: 78 },
    thickness: 0.7,
    color: assets.line,
  });
  page.drawText("SYNTHETIC INTERVIEW DEMONSTRATION - NO BUSINESS TRANSACTION", {
    x: 48,
    y: 60,
    font: assets.helveticaBold,
    size: 6.5,
    color: assets.slate,
  });
  drawTextFitted(page, fixtureId, {
    x: 420,
    y: 60,
    font: assets.helvetica,
    size: 6.5,
    maxWidth: 127,
    color: assets.slate,
  });
}

function invoicePresentation(fixture) {
  const invoiceTotal = textValue(fixture.documentData.invoice_total);
  const numericTotal = Number.parseFloat(invoiceTotal) || 0;
  const subtotal = (numericTotal / 1.09).toFixed(2);
  const tax = (numericTotal - Number(subtotal)).toFixed(2);
  return {
    ...fixture,
    lineItems: [
      {
        description: "Office supplies batch",
        quantity: "1",
        unitPrice: `${subtotal} ${fixture.documentData.currency}`,
        amount: `${subtotal} ${fixture.documentData.currency}`,
      },
      {
        description: "Freight handling",
        quantity: "1",
        unitPrice: `0.00 ${fixture.documentData.currency}`,
        amount: `0.00 ${fixture.documentData.currency}`,
      },
      {
        description: "Delivery confirmation",
        quantity: "1",
        unitPrice: `0.00 ${fixture.documentData.currency}`,
        amount: `0.00 ${fixture.documentData.currency}`,
      },
    ],
    financials: {
      subtotal: `${subtotal} ${fixture.documentData.currency}`,
      tax: `${tax} ${fixture.documentData.currency}`,
      invoiceTotal,
    },
  };
}

function warehousePresentation(fixture) {
  const itemCode = textValue(fixture.documentData.item_code);
  const lotNumber = textValue(fixture.documentData.lot_number);
  const expected = textValue(fixture.documentData.expected_quantity);
  const received = textValue(fixture.documentData.received_quantity);
  const damaged = textValue(fixture.documentData.damaged_quantity);
  return {
    ...fixture,
    warehouseName: fixture.title.replace(/ goods receipt$/, ""),
    carrier: "Atlas Freight Services",
    receivedDate: "2026-08-18",
    receivingRows: [
      { itemCode, lotNumber, expected, received, damaged },
      {
        itemCode: "PACKING-MATERIAL",
        lotNumber: "LOT-SYN-02",
        expected: "0",
        received: "0",
        damaged: "0",
      },
      {
        itemCode: "DELIVERY-PALLET",
        lotNumber: "LOT-SYN-03",
        expected: "0",
        received: "0",
        damaged: "0",
      },
    ],
  };
}

async function createSupplierInvoice(fixture, assets) {
  const document = await createBaseDocument(fixture);
  const page = document.addPage([595.28, 841.89]);
  const pageAssets = await loadAssets(document, assets.textureBytes);
  drawPageFrame(page, pageAssets);
  drawDocumentHeader(page, pageAssets, {
    documentType: "SUPPLIER INVOICE",
    organization: fixture.documentData.supplier,
    identifier: fixture.documentData.invoice_number,
  });
  drawTextFitted(page, fixture.title, {
    x: 48,
    y: 704,
    font: pageAssets.helvetica,
    size: 7.5,
    maxWidth: 360,
    color: pageAssets.slate,
  });
  drawKeyValueGrid(page, pageAssets, [
    ["Invoice date", fixture.documentData.invoice_date],
    ["Purchase order", fixture.documentData.purchase_order_number],
    ["Currency", fixture.documentData.currency],
    ["Payment terms", fixture.documentData.payment_terms],
  ]);
  drawInvoiceLineItems(page, pageAssets, fixture.lineItems);
  drawInvoiceTotals(page, pageAssets, fixture.financials);
  await drawCommentsBox(
    document,
    page,
    pageAssets,
    fixture,
    "Reviewer comments",
  );
  drawSyntheticFooter(page, pageAssets, fixture.id);
  return document.save({ useObjectStreams: false });
}

async function createWarehouseReceipt(fixture, assets) {
  const document = await createBaseDocument(fixture);
  const page = document.addPage([595.28, 841.89]);
  const pageAssets = await loadAssets(document, assets.textureBytes);
  drawPageFrame(page, pageAssets);
  drawDocumentHeader(page, pageAssets, {
    documentType: "WAREHOUSE GOODS RECEIPT",
    organization: fixture.warehouseName,
    identifier: fixture.documentData.goods_receipt_number,
  });
  drawTextFitted(page, fixture.title, {
    x: 48,
    y: 704,
    font: pageAssets.helvetica,
    size: 7.5,
    maxWidth: 360,
    color: pageAssets.slate,
  });
  drawKeyValueGrid(page, pageAssets, [
    ["Delivery note", fixture.documentData.delivery_note_number],
    ["Purchase order", fixture.documentData.purchase_order_number],
    ["Carrier", fixture.carrier],
    ["Received date", fixture.receivedDate],
  ]);
  drawReceivingTable(page, pageAssets, fixture.receivingRows);
  drawQuantitySummary(page, pageAssets, {
    expected: fixture.documentData.expected_quantity,
    received: fixture.documentData.received_quantity,
    damaged: fixture.documentData.damaged_quantity,
  });
  await drawCommentsBox(
    document,
    page,
    pageAssets,
    fixture,
    "Receiver comments",
  );
  drawSyntheticFooter(page, pageAssets, fixture.id);
  return document.save({ useObjectStreams: false });
}

GlobalFonts.registerFromPath(handwritingFontPath, "Caveat");
const textureBytes = await preparePageTexture(await readFile(texturePath));
const assets = { textureBytes };
for (const fixture of await loadSyntheticFixtures()) {
  if (approvedOverrideFilenames.has(fixture.filename)) {
    await copyFile(
      resolve(sampleOverridesDirectory, fixture.filename),
      resolve(samplesDirectory, fixture.filename),
    );
    console.log(`Copied approved override ${fixture.filename}`);
    continue;
  }
  const presentation =
    fixture.family === "supplier_invoice"
      ? invoicePresentation(fixture)
      : warehousePresentation(fixture);
  const bytes =
    fixture.family === "supplier_invoice"
      ? await createSupplierInvoice(presentation, assets)
      : await createWarehouseReceipt(presentation, assets);
  await writeFile(resolve(samplesDirectory, fixture.filename), bytes);
  console.log(`Generated ${fixture.filename}`);
}
