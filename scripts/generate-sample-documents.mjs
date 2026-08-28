import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const samplesDirectory = resolve(projectDirectory, "public", "samples");
const fixtureSource = resolve(projectDirectory, "src", "domain", "fixtures.ts");
const texturePath = resolve(samplesDirectory, "scanned-paper-texture.png");
const generatedAt = new Date("2026-08-28T00:00:00.000Z");

async function loadSyntheticFixtures() {
  const source = await readFile(fixtureSource, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  const fixtures = await import(moduleUrl);
  return fixtures.syntheticFixtures;
}

function formValue(value) {
  return value ?? "Not provided";
}

function drawRule(page, y) {
  page.drawLine({
    start: { x: 54, y },
    end: { x: 558, y },
    thickness: 0.8,
    color: rgb(0.76, 0.78, 0.8),
  });
}

async function preparePageTexture(textureBytes) {
  const source = await loadImage(textureBytes);
  const canvas = createCanvas(612, 792);
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, 612, 792);
  return canvas.toBuffer("image/jpeg", 70);
}

async function createDocument(fixture, textureBytes) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(fixture.title);
  pdf.setAuthor("Document Intelligence Assurance Hub");
  pdf.setSubject("Synthetic operational document fixture");
  pdf.setKeywords(["synthetic", "sample", fixture.id]);
  pdf.setProducer("Document Intelligence Assurance Hub");
  pdf.setCreator("Document Intelligence Assurance Hub");
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);

  const page = pdf.addPage([612, 792]);
  const texture = await pdf.embedJpg(textureBytes);
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const courierOblique = await pdf.embedFont(StandardFonts.CourierOblique);
  const form = pdf.getForm();

  page.drawImage(texture, { x: 0, y: 0, width: 612, height: 792, opacity: 0.09 });
  page.drawRectangle({
    x: 42,
    y: 40,
    width: 528,
    height: 712,
    borderWidth: 1,
    borderColor: rgb(0.64, 0.67, 0.7),
    color: rgb(1, 1, 1),
    opacity: 0.83,
  });
  page.drawText("OPERATIONS SAMPLE", {
    x: 58,
    y: 724,
    font: helveticaBold,
    size: 9,
    color: rgb(0.22, 0.29, 0.39),
  });
  page.drawText(fixture.title, {
    x: 58,
    y: 690,
    font: helveticaBold,
    size: 21,
    color: rgb(0.1, 0.14, 0.2),
  });
  page.drawText("Synthetic training document - no real person or organization data", {
    x: 58,
    y: 670,
    font: helvetica,
    size: 8,
    color: rgb(0.35, 0.4, 0.46),
  });
  drawRule(page, 654);

  page.drawText("DOCUMENT DETAILS", {
    x: 58,
    y: 626,
    font: helveticaBold,
    size: 10,
    color: rgb(0.18, 0.24, 0.31),
  });

  let y = 584;
  for (const field of fixture.requestedFields) {
    const value = formValue(fixture.documentData[field.key]);
    page.drawText(field.label.toUpperCase(), {
      x: 58,
      y: y + 7,
      font: helveticaBold,
      size: 8,
      color: rgb(0.31, 0.37, 0.44),
    });
    page.drawRectangle({
      x: 224,
      y,
      width: 318,
      height: 25,
      borderWidth: 0.8,
      borderColor: rgb(0.65, 0.68, 0.72),
      color: rgb(0.99, 0.99, 0.98),
    });
    page.drawText(value, {
      x: 234,
      y: y + 8,
      font: helvetica,
      size: 10,
      color: rgb(0.11, 0.14, 0.18),
    });
    const input = form.createTextField(`${fixture.id}-${field.key}`);
    input.setText(value);
    input.addToPage(page, {
      x: 224,
      y,
      width: 318,
      height: 25,
      borderWidth: 0,
      textColor: rgb(0.11, 0.14, 0.18),
      font: helvetica,
      fontSize: 10,
    });
    y -= 52;
  }

  drawRule(page, 402);
  page.drawText("PROCESSING NOTE", {
    x: 58,
    y: 376,
    font: helveticaBold,
    size: 10,
    color: rgb(0.18, 0.24, 0.31),
  });
  page.drawText(fixture.description, {
    x: 58,
    y: 354,
    font: helvetica,
    size: 10,
    color: rgb(0.17, 0.2, 0.25),
  });
  page.drawRectangle({
    x: 58,
    y: 256,
    width: 484,
    height: 66,
    borderWidth: 1.1,
    borderColor: rgb(0.51, 0.22, 0.18),
    color: rgb(1, 0.97, 0.94),
  });
  page.drawText("HANDWRITTEN INSTRUCTION", {
    x: 72,
    y: 300,
    font: helveticaBold,
    size: 8,
    color: rgb(0.51, 0.22, 0.18),
  });
  page.drawText(fixture.action.instructionEvidence ?? "No instruction provided.", {
    x: 76,
    y: 274,
    font: courierOblique,
    size: 15,
    rotate: degrees(-2.5),
    color: rgb(0.44, 0.12, 0.1),
  });
  page.drawText("Synthetic fixture | one page | public-safe", {
    x: 58,
    y: 64,
    font: helvetica,
    size: 8,
    color: rgb(0.35, 0.4, 0.46),
  });
  page.drawText("Page 1 of 1", {
    x: 474,
    y: 64,
    font: helvetica,
    size: 8,
    color: rgb(0.35, 0.4, 0.46),
  });

  form.updateFieldAppearances(helvetica);
  return pdf.save({ addDefaultPage: false, useObjectStreams: false, updateFieldAppearances: true });
}

const fixtures = await loadSyntheticFixtures();
const textureBytes = await preparePageTexture(await readFile(texturePath));
for (const fixture of fixtures) {
  const document = await createDocument(fixture, textureBytes);
  await writeFile(resolve(samplesDirectory, fixture.filename), document);
  console.log(`Generated ${fixture.filename}`);
}
